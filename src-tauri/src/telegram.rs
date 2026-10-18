//! Everything that talks to Telegram. The UI only ever sees the plain
//! summaries and errors defined here, never the session or API keys.

use std::collections::HashMap;
use std::num::NonZeroU32;
use std::ops::ControlFlow;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use base64::Engine as _;
use grammers_client::client::{LoginToken, PasswordToken};
use grammers_client::peer::Peer;
use grammers_client::session::types::PeerRef;
use grammers_client::{Client, InvocationError, SignInError, tl};
use grammers_mtsender::{ConnectionParams, RetryContext, RetryPolicy, SenderPool};
use grammers_session::storages::MemorySession;
use serde::Serialize;
use tauri::async_runtime::JoinHandle;
use tauri::ipc::Channel;

use crate::detect::{Category, ChatKind};
use crate::session_store;

/// Time between the start of one delete and the next.
const DELETE_PACE: Duration = Duration::from_secs(1);
/// Stop deleting after this many network failures in a row.
const MAX_NETWORK_FAILURES: u32 = 3;
/// Profile photos larger than this are skipped (the small size is ~10 KB).
const MAX_AVATAR_BYTES: usize = 256 * 1024;

// ---------------------------------------------------------------------------
// Types shared with the UI

/// Errors the UI knows how to explain. Copy lives in the UI.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UiError {
    MissingApiKeys,
    InvalidPhone,
    InvalidCode,
    CodeExpired,
    InvalidPassword,
    NeedsSignUp,
    NotLoggedIn,
    RateLimited { seconds: u64 },
    Network,
    Other { message: String },
}

impl From<InvocationError> for UiError {
    fn from(error: InvocationError) -> Self {
        match &error {
            InvocationError::Rpc(rpc) if rpc.code == 420 => {
                UiError::RateLimited { seconds: rpc.value.unwrap_or(30) as u64 }
            }
            InvocationError::Rpc(rpc) => match rpc.name.as_str() {
                "PHONE_NUMBER_INVALID" | "PHONE_NUMBER_UNOCCUPIED" => UiError::InvalidPhone,
                "PHONE_CODE_INVALID" | "PHONE_CODE_EMPTY" => UiError::InvalidCode,
                "PHONE_CODE_EXPIRED" => UiError::CodeExpired,
                "PASSWORD_HASH_INVALID" => UiError::InvalidPassword,
                "AUTH_KEY_UNREGISTERED" | "SESSION_REVOKED" | "USER_DEACTIVATED" => UiError::NotLoggedIn,
                _ => UiError::Other { message: error.to_string() },
            },
            InvocationError::Io(_) | InvocationError::Dropped(_) => UiError::Network,
            _ => UiError::Other { message: error.to_string() },
        }
    }
}

impl From<SignInError> for UiError {
    fn from(error: SignInError) -> Self {
        match error {
            SignInError::InvalidCode => UiError::InvalidCode,
            SignInError::InvalidPassword(_) => UiError::InvalidPassword,
            SignInError::SignUpRequired => UiError::NeedsSignUp,
            SignInError::PasswordRequired(_) => UiError::Other {
                message: "Unexpected password request".into(),
            },
            SignInError::Other(e) => e.into(),
        }
    }
}

pub type UiResult<T> = Result<T, UiError>;

#[derive(Serialize)]
#[serde(tag = "step", rename_all = "camelCase")]
pub enum LoginStep {
    Done,
    PasswordNeeded { hint: Option<String> },
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum ScanEvent {
    Progress { checked: usize },
    /// Telegram asked us to wait. The scan resumes on its own afterwards.
    RateLimited { seconds: u64 },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSummary {
    pub id: String,
    /// Empty for deleted accounts; the UI shows "Deleted Account".
    pub name: String,
    pub deleted_account: bool,
    pub has_photo: bool,
    /// Unix seconds of the chat's latest message (the join notice).
    pub date: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryResult {
    pub category: Category,
    pub chats: Vec<ChatSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub checked: usize,
    /// One entry per category, in display order, even when empty.
    pub categories: Vec<CategoryResult>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarEvent {
    pub id: String,
    pub data_url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SkipReason {
    /// A new message arrived after the scan, so the chat is no longer a match.
    NewMessages,
    /// The chat has no messages left (removed elsewhere already).
    AlreadyGone,
    /// The id wasn't part of the latest scan.
    NotInScan,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FailReason {
    Network,
    Telegram { code: String },
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "result", rename_all = "camelCase")]
pub enum Outcome {
    /// Removed (or, in a dry run, would have been removed).
    Deleted,
    Skipped { reason: SkipReason },
    Failed { reason: FailReason },
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum DeleteEvent {
    /// Work on chat `index` (1-based) is starting.
    Started { index: usize, total: usize, id: String },
    Finished { index: usize, total: usize, id: String, outcome: Outcome },
    RateLimited { seconds: u64 },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOutcome {
    pub id: String,
    pub outcome: Outcome,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteReport {
    pub dry_run: bool,
    pub total: usize,
    pub deleted: usize,
    /// Skipped and failed chats, with reasons.
    pub not_deleted: Vec<ChatOutcome>,
    /// The user pressed Stop; the remaining chats were not touched.
    pub stopped: bool,
    /// Stopped early after repeated network failures.
    pub connection_lost: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub dry_run: bool,
    pub version: &'static str,
}

/// Debug builds never delete unless SIFT_DRY_RUN=0 is set explicitly.
/// Release builds delete for real unless SIFT_DRY_RUN is set to anything else.
pub fn dry_run() -> bool {
    match std::env::var("SIFT_DRY_RUN") {
        Ok(value) => value.trim() != "0",
        Err(_) => cfg!(debug_assertions),
    }
}

pub fn app_info() -> AppInfo {
    AppInfo { dry_run: dry_run(), version: env!("CARGO_PKG_VERSION") }
}

// ---------------------------------------------------------------------------
// State

/// Retry dropped connections briefly, but hand every FLOOD_WAIT back to us
/// so the UI can show a countdown instead of freezing.
struct RetryNetworkOnly;

impl RetryPolicy for RetryNetworkOnly {
    fn should_retry(&self, ctx: &RetryContext) -> ControlFlow<(), Duration> {
        match ctx.error {
            InvocationError::Io(_) if ctx.fail_count <= NonZeroU32::new(2).unwrap() => {
                ControlFlow::Continue(Duration::from_secs(1))
            }
            _ => ControlFlow::Break(()),
        }
    }
}

struct Connection {
    client: Client,
    session: Arc<MemorySession>,
    runner: JoinHandle<()>,
}

/// A chat found by the latest scan. Kept here so the UI only handles ids.
#[derive(Clone)]
struct Candidate {
    peer: Peer,
    peer_ref: PeerRef,
    category: Category,
}

#[derive(Default)]
pub struct Telegram {
    connection: Option<Connection>,
    restored: bool,
    login_token: Option<LoginToken>,
    password_token: Option<PasswordToken>,
    candidates: HashMap<String, Candidate>,
}

pub type TelegramState = tokio::sync::Mutex<Telegram>;

/// Signals that must work while another command holds the Telegram state.
#[derive(Default)]
pub struct Controls {
    stop_deleting: AtomicBool,
    /// Bumped by every scan so a stale avatar download stops.
    scan_generation: AtomicU64,
}

impl Controls {
    pub fn request_stop(&self) {
        self.stop_deleting.store(true, Ordering::SeqCst);
    }
}

fn api_credentials() -> UiResult<(i32, &'static str)> {
    let id = option_env!("SIFT_API_ID").and_then(|v| v.parse().ok());
    match (id, option_env!("SIFT_API_HASH")) {
        (Some(id), Some(hash)) => Ok((id, hash)),
        _ => Err(UiError::MissingApiKeys),
    }
}

impl Telegram {
    pub async fn client(&mut self) -> UiResult<Client> {
        if let Some(connection) = &self.connection {
            return Ok(connection.client.clone());
        }
        let (api_id, _) = api_credentials()?;
        let (session, restored) = session_store::load().await;
        let session = Arc::new(session);
        let params = ConnectionParams {
            device_model: "Sift".into(),
            system_version: std::env::consts::OS.into(),
            app_version: env!("CARGO_PKG_VERSION").into(),
            retry_policy: Box::new(RetryNetworkOnly),
            ..Default::default()
        };
        let SenderPool { runner, handle, .. } =
            SenderPool::with_configuration(Arc::clone(&session), api_id, params);
        let client = Client::new(handle);
        let runner = tauri::async_runtime::spawn(async move {
            runner.run().await;
        });
        self.restored = restored;
        self.connection = Some(Connection { client: client.clone(), session, runner });
        Ok(client)
    }

    fn save_session(&self) -> UiResult<()> {
        let connection = self.connection.as_ref().ok_or(UiError::NotLoggedIn)?;
        session_store::save(&connection.session).map_err(|message| UiError::Other { message })
    }

    /// True when a saved session is still accepted by Telegram.
    pub async fn restore(&mut self) -> UiResult<bool> {
        let client = self.client().await?;
        if !self.restored {
            return Ok(false);
        }
        Ok(client.is_authorized().await?)
    }

    pub async fn request_code(&mut self, phone: &str) -> UiResult<()> {
        let (_, api_hash) = api_credentials()?;
        let phone: String = phone.chars().filter(|c| c.is_ascii_digit() || *c == '+').collect();
        if phone.len() < 6 {
            return Err(UiError::InvalidPhone);
        }
        let client = self.client().await?;
        self.login_token = Some(client.request_login_code(&phone, api_hash).await?);
        self.password_token = None;
        Ok(())
    }

    pub async fn submit_code(&mut self, code: &str) -> UiResult<LoginStep> {
        let client = self.client().await?;
        let token = self.login_token.as_ref().ok_or(UiError::CodeExpired)?;
        match client.sign_in(token, code.trim()).await {
            Ok(_) => {
                self.login_token = None;
                self.save_session()?;
                Ok(LoginStep::Done)
            }
            Err(SignInError::PasswordRequired(password_token)) => {
                let hint = password_token.hint().map(str::to_string);
                self.password_token = Some(password_token);
                Ok(LoginStep::PasswordNeeded { hint })
            }
            Err(e) => Err(e.into()),
        }
    }

    pub async fn submit_password(&mut self, password: &str) -> UiResult<()> {
        let client = self.client().await?;
        let token = self.password_token.take().ok_or(UiError::NotLoggedIn)?;
        match client.check_password(token, password).await {
            Ok(_) => {
                self.login_token = None;
                self.save_session()
            }
            Err(SignInError::InvalidPassword(retry_token)) => {
                self.password_token = Some(retry_token);
                Err(UiError::InvalidPassword)
            }
            Err(e) => Err(e.into()),
        }
    }

    /// Ends the session with Telegram (when reachable) and removes it locally.
    pub async fn log_out(&mut self) -> UiResult<()> {
        if let Some(connection) = self.connection.take() {
            let _ = connection.client.sign_out().await;
            connection.runner.abort();
        }
        *self = Telegram::default();
        session_store::clear().map_err(|message| UiError::Other { message })
    }
}

// ---------------------------------------------------------------------------
// Scan (read-only)

/// Runs a read-only scan, then stores the matches for avatars and deletion.
pub async fn scan(
    state: &TelegramState,
    controls: &Controls,
    on_event: &Channel<ScanEvent>,
) -> UiResult<ScanResult> {
    controls.scan_generation.fetch_add(1, Ordering::SeqCst);
    let client = state.lock().await.client().await?;
    let on_wait = |seconds| {
        let _ = on_event.send(ScanEvent::RateLimited { seconds });
    };

    let mut checked = 0;
    let mut found: Vec<(Category, ChatSummary, Candidate)> = Vec::new();
    let mut dialogs = client.iter_dialogs();
    loop {
        let dialog = match dialogs.next().await {
            Ok(Some(dialog)) => dialog,
            Ok(None) => break,
            Err(e) => {
                wait_if_rate_limited(e, &on_wait).await?;
                continue;
            }
        };
        checked += 1;
        let _ = on_event.send(ScanEvent::Progress { checked });

        let (kind, name, deleted, has_photo) = match dialog.peer() {
            Peer::User(user) => (
                ChatKind::User { is_self: user.is_self(), is_bot: user.is_bot() },
                user.full_name(),
                user.deleted(),
                user.photo().is_some(),
            ),
            _ => (ChatKind::Other, String::new(), false, false),
        };
        let last = dialog.last_message.as_ref();
        let last_action = last.and_then(|m| m.action());

        // Fetch the latest messages only for chats a category could match,
        // and only once per chat.
        let mut recent = None;
        let mut matched = None;
        for category in Category::ALL {
            if !category.may_match(kind, last_action) {
                continue;
            }
            if recent.is_none() {
                let limit = Category::ALL.iter().map(|c| c.messages_needed()).max().unwrap_or(2);
                recent = Some(recent_actions_waiting(&client, dialog.peer_ref(), limit, &on_wait).await?);
            }
            if category.confirm(recent.as_deref().unwrap_or_default()) {
                matched = Some(category);
                break;
            }
        }
        let Some(category) = matched else { continue };

        let peer_ref = dialog.peer_ref();
        let id = peer_ref.id.to_string();
        let summary = ChatSummary {
            id,
            name: if deleted { String::new() } else { name.trim().to_string() },
            deleted_account: deleted,
            has_photo,
            date: last.map(|m| m.date().as_second()).unwrap_or_default(),
        };
        found.push((category, summary, Candidate { peer: dialog.peer().clone(), peer_ref, category }));
    }

    let mut categories: Vec<CategoryResult> = Category::ALL
        .iter()
        .map(|&category| CategoryResult { category, chats: Vec::new() })
        .collect();
    let mut candidates = HashMap::new();
    for (category, summary, candidate) in found {
        candidates.insert(summary.id.clone(), candidate);
        if let Some(group) = categories.iter_mut().find(|g| g.category == category) {
            group.chats.push(summary);
        }
    }
    state.lock().await.candidates = candidates;
    Ok(ScanResult { checked, categories })
}

/// Downloads small profile photos for the latest scan's matches, one at a
/// time. Best effort: a rate limit or a newer scan simply stops it, and the
/// UI keeps showing initials.
pub async fn load_avatars(
    state: &TelegramState,
    controls: &Controls,
    on_event: &Channel<AvatarEvent>,
) -> UiResult<()> {
    let generation = controls.scan_generation.load(Ordering::SeqCst);
    let (client, peers): (Client, Vec<(String, Peer)>) = {
        let mut telegram = state.lock().await;
        let client = telegram.client().await?;
        let mut peers: Vec<_> = telegram
            .candidates
            .iter()
            .map(|(id, c)| (id.clone(), c.peer.clone()))
            .collect();
        peers.sort_by(|a, b| a.0.cmp(&b.0));
        (client, peers)
    };

    for (id, peer) in peers {
        if controls.scan_generation.load(Ordering::SeqCst) != generation {
            break;
        }
        let photo = match peer.photo(false).await {
            Ok(Some(photo)) => photo,
            Ok(None) => continue,
            Err(e) if flood_wait_secs(&e).is_some() => break,
            Err(_) => continue,
        };
        let mut bytes = Vec::new();
        let mut download = client.iter_download(&photo);
        let complete = loop {
            match download.next().await {
                Ok(Some(chunk)) => {
                    bytes.extend_from_slice(&chunk);
                    if bytes.len() > MAX_AVATAR_BYTES {
                        break false;
                    }
                }
                Ok(None) => break true,
                Err(e) if flood_wait_secs(&e).is_some() => return Ok(()),
                Err(_) => break false,
            }
        };
        if complete && !bytes.is_empty() {
            let data_url = format!(
                "data:{};base64,{}",
                image_mime(&bytes),
                base64::engine::general_purpose::STANDARD.encode(&bytes)
            );
            let _ = on_event.send(AvatarEvent { id, data_url });
        }
    }
    Ok(())
}

fn image_mime(bytes: &[u8]) -> &'static str {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "image/webp",
        _ => "image/jpeg",
    }
}

// ---------------------------------------------------------------------------
// Delete

/// Deletes the chosen chats for this account only (`revoke: false`), one at a
/// time at about one per second. Each chat is re-checked right before; a chat
/// that changed since the scan is skipped and reported.
pub async fn delete_chats(
    state: &TelegramState,
    controls: &Controls,
    ids: Vec<String>,
    on_event: &Channel<DeleteEvent>,
) -> UiResult<DeleteReport> {
    controls.stop_deleting.store(false, Ordering::SeqCst);
    let dry_run = dry_run();
    let (client, targets): (Client, Vec<(String, Option<Candidate>)>) = {
        let mut telegram = state.lock().await;
        let client = telegram.client().await?;
        let targets = ids
            .into_iter()
            .map(|id| {
                let candidate = telegram.candidates.get(&id).cloned();
                (id, candidate)
            })
            .collect();
        (client, targets)
    };
    let on_wait = |seconds| {
        let _ = on_event.send(DeleteEvent::RateLimited { seconds });
    };

    let total = targets.len();
    let mut report = DeleteReport {
        dry_run,
        total,
        deleted: 0,
        not_deleted: Vec::new(),
        stopped: false,
        connection_lost: false,
    };
    let mut removed = Vec::new();
    let mut network_failures = 0;

    for (i, (id, candidate)) in targets.into_iter().enumerate() {
        if controls.stop_deleting.load(Ordering::SeqCst) {
            report.stopped = true;
            break;
        }
        let index = i + 1;
        let started = Instant::now();
        let _ = on_event.send(DeleteEvent::Started { index, total, id: id.clone() });

        let outcome = match &candidate {
            None => Outcome::Skipped { reason: SkipReason::NotInScan },
            Some(c) => delete_one(&client, c, dry_run, &on_wait).await,
        };
        match &outcome {
            Outcome::Deleted => {
                report.deleted += 1;
                removed.push(id.clone());
            }
            Outcome::Skipped { reason: SkipReason::AlreadyGone } => {
                removed.push(id.clone());
                report.not_deleted.push(ChatOutcome { id: id.clone(), outcome: outcome.clone() });
            }
            _ => report.not_deleted.push(ChatOutcome { id: id.clone(), outcome: outcome.clone() }),
        }
        network_failures = match &outcome {
            Outcome::Failed { reason: FailReason::Network } => network_failures + 1,
            _ => 0,
        };
        let _ = on_event.send(DeleteEvent::Finished { index, total, id, outcome });

        if network_failures >= MAX_NETWORK_FAILURES {
            report.connection_lost = true;
            break;
        }
        if index < total {
            tokio::time::sleep(DELETE_PACE.saturating_sub(started.elapsed())).await;
        }
    }

    if !dry_run {
        let mut telegram = state.lock().await;
        for id in removed {
            telegram.candidates.remove(&id);
        }
    }
    Ok(report)
}

async fn delete_one(client: &Client, candidate: &Candidate, dry_run: bool, on_wait: &WaitNotice<'_>) -> Outcome {
    loop {
        let attempt = async {
            let recent =
                recent_actions(client, candidate.peer_ref, candidate.category.messages_needed()).await?;
            if recent.is_empty() {
                return Ok(Outcome::Skipped { reason: SkipReason::AlreadyGone });
            }
            if !candidate.category.confirm(&recent) {
                return Ok(Outcome::Skipped { reason: SkipReason::NewMessages });
            }
            if !dry_run {
                delete_history(client, candidate.peer_ref).await?;
            }
            Ok::<_, InvocationError>(Outcome::Deleted)
        };
        match attempt.await {
            Ok(outcome) => return outcome,
            Err(e) => {
                if let Some(seconds) = flood_wait_secs(&e) {
                    on_wait(seconds);
                    tokio::time::sleep(Duration::from_secs(seconds)).await;
                    continue;
                }
                let reason = match e {
                    InvocationError::Rpc(rpc) => FailReason::Telegram { code: rpc.name },
                    _ => FailReason::Network,
                };
                return Outcome::Failed { reason };
            }
        }
    }
}

/// Removes the chat for this account only. `revoke: false` leaves the other
/// person's copy alone; contacts are not touched.
async fn delete_history(client: &Client, peer: PeerRef) -> Result<(), InvocationError> {
    loop {
        let tl::enums::messages::AffectedHistory::History(affected) = client
            .invoke(&tl::functions::messages::DeleteHistory {
                just_clear: false,
                revoke: false,
                peer: peer.into(),
                max_id: 0,
                min_date: None,
                max_date: None,
            })
            .await?;
        // Telegram deletes in batches; a positive offset means call again.
        if affected.offset <= 0 {
            return Ok(());
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers

/// Tells the UI that Telegram asked us to wait this many seconds.
type WaitNotice<'a> = dyn Fn(u64) + Send + Sync + 'a;

/// FLOOD_WAIT_n arrives as RPC error 420 with n in `value`.
fn flood_wait_secs(error: &InvocationError) -> Option<u64> {
    match error {
        InvocationError::Rpc(rpc) if rpc.code == 420 => Some(rpc.value.unwrap_or(30) as u64),
        _ => None,
    }
}

/// Sleeps out a FLOOD_WAIT (telling the UI first); any other error is returned.
async fn wait_if_rate_limited(error: InvocationError, on_wait: &WaitNotice<'_>) -> UiResult<()> {
    match flood_wait_secs(&error) {
        Some(seconds) => {
            on_wait(seconds);
            tokio::time::sleep(Duration::from_secs(seconds)).await;
            Ok(())
        }
        None => Err(error.into()),
    }
}

/// Up to `limit` latest message actions in a chat, newest first. One attempt.
async fn recent_actions(
    client: &Client,
    peer: PeerRef,
    limit: usize,
) -> Result<Vec<Option<tl::enums::MessageAction>>, InvocationError> {
    let mut out = Vec::with_capacity(limit);
    let mut messages = client.iter_messages(peer).limit(limit);
    while let Some(message) = messages.next().await? {
        out.push(message.action().cloned());
    }
    Ok(out)
}

/// Like `recent_actions`, but waits out rate limits.
async fn recent_actions_waiting(
    client: &Client,
    peer: PeerRef,
    limit: usize,
    on_wait: &WaitNotice<'_>,
) -> UiResult<Vec<Option<tl::enums::MessageAction>>> {
    loop {
        match recent_actions(client, peer, limit).await {
            Ok(actions) => return Ok(actions),
            Err(e) => wait_if_rate_limited(e, on_wait).await?,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_image_types() {
        assert_eq!(image_mime(&[0x89, b'P', b'N', b'G', 0, 0]), "image/png");
        assert_eq!(image_mime(b"RIFF\0\0\0\0WEBPVP8 "), "image/webp");
        assert_eq!(image_mime(&[0xFF, 0xD8, 0xFF]), "image/jpeg");
    }

    #[test]
    fn errors_map_to_ui_kinds() {
        let rpc = |code, name: &str, value| {
            InvocationError::Rpc(grammers_mtsender::RpcError {
                code,
                name: name.into(),
                value,
                caused_by: None,
            })
        };
        assert!(matches!(UiError::from(rpc(420, "FLOOD_WAIT", Some(31))), UiError::RateLimited { seconds: 31 }));
        assert!(matches!(UiError::from(rpc(400, "PHONE_CODE_EXPIRED", None)), UiError::CodeExpired));
        assert!(matches!(UiError::from(rpc(400, "PHONE_NUMBER_INVALID", None)), UiError::InvalidPhone));
        assert!(matches!(UiError::from(rpc(401, "AUTH_KEY_UNREGISTERED", None)), UiError::NotLoggedIn));
        assert_eq!(flood_wait_secs(&rpc(420, "FLOOD_WAIT", Some(5))), Some(5));
        assert_eq!(flood_wait_secs(&rpc(400, "PEER_ID_INVALID", None)), None);
    }
}
