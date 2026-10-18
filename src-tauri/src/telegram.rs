//! Everything that talks to Telegram. The UI only ever sees the plain
//! summaries and errors defined here, never the session or API keys.

use std::collections::HashMap;
use std::num::NonZeroU32;
use std::ops::ControlFlow;
use std::sync::Arc;
use std::time::Duration;

use grammers_client::client::{LoginToken, PasswordToken};
use grammers_client::peer::Peer;
use grammers_client::session::types::PeerRef;
use grammers_client::{Client, InvocationError, SignInError, tl};
use grammers_mtsender::{ConnectionParams, RetryContext, RetryPolicy, SenderPool};
use grammers_session::storages::MemorySession;
use serde::Serialize;
use tauri::async_runtime::JoinHandle;
use tauri::ipc::Channel;

use crate::detect::{ChatKind, passes_cheap_check, passes_strict_check};
use crate::session_store;

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

type UiResult<T> = Result<T, UiError>;

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSummary {
    pub id: String,
    pub name: String,
    pub deleted_account: bool,
    /// Unix seconds of the join notice.
    pub date: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub checked: usize,
    pub join_only: Vec<ChatSummary>,
}

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

#[derive(Default)]
pub struct Telegram {
    connection: Option<Connection>,
    restored: bool,
    login_token: Option<LoginToken>,
    password_token: Option<PasswordToken>,
    /// Matches from the last scan, kept here so deletion (milestone 3) can
    /// work from ids without the UI ever holding peer references.
    join_only: HashMap<String, PeerRef>,
}

pub type TelegramState = tokio::sync::Mutex<Telegram>;

fn api_credentials() -> UiResult<(i32, &'static str)> {
    let id = option_env!("SIFT_API_ID").and_then(|v| v.parse().ok());
    match (id, option_env!("SIFT_API_HASH")) {
        (Some(id), Some(hash)) => Ok((id, hash)),
        _ => Err(UiError::MissingApiKeys),
    }
}

impl Telegram {
    async fn client(&mut self) -> UiResult<Client> {
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

    /// Read-only. Applies the rules in `detect` to every chat.
    pub async fn scan(&mut self, on_event: &Channel<ScanEvent>) -> UiResult<ScanResult> {
        let client = self.client().await?;
        let mut checked = 0;
        let mut join_only = Vec::new();
        self.join_only.clear();
        let mut dialogs = client.iter_dialogs();

        loop {
            let dialog = match dialogs.next().await {
                Ok(Some(dialog)) => dialog,
                Ok(None) => break,
                Err(e) => {
                    wait_if_rate_limited(e, on_event).await?;
                    continue;
                }
            };
            checked += 1;
            let _ = on_event.send(ScanEvent::Progress { checked });

            let (kind, name, deleted) = match dialog.peer() {
                Peer::User(user) => (
                    ChatKind::User { is_self: user.is_self(), is_bot: user.is_bot() },
                    user.full_name(),
                    user.deleted(),
                ),
                _ => (ChatKind::Other, String::new(), false),
            };
            let last = dialog.last_message.as_ref();
            if !passes_cheap_check(kind, last.and_then(|m| m.action())) {
                continue;
            }
            let peer = dialog.peer_ref();
            if !passes_strict_check(&recent_actions(&client, peer, on_event).await?) {
                continue;
            }

            let id = peer.id.to_string();
            self.join_only.insert(id.clone(), peer);
            join_only.push(ChatSummary {
                id,
                name: if deleted { String::new() } else { name.trim().to_string() },
                deleted_account: deleted,
                date: last.map(|m| m.date().as_second()).unwrap_or_default(),
            });
        }
        Ok(ScanResult { checked, join_only })
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

/// Sleeps out a FLOOD_WAIT (telling the UI first); any other error is returned.
async fn wait_if_rate_limited(error: InvocationError, on_event: &Channel<ScanEvent>) -> UiResult<()> {
    match UiError::from(error) {
        UiError::RateLimited { seconds } => {
            let _ = on_event.send(ScanEvent::RateLimited { seconds });
            tokio::time::sleep(Duration::from_secs(seconds)).await;
            Ok(())
        }
        other => Err(other),
    }
}

/// Up to 2 latest message actions in a chat (rule 3), retrying through rate limits.
async fn recent_actions(
    client: &Client,
    peer: PeerRef,
    on_event: &Channel<ScanEvent>,
) -> UiResult<Vec<Option<tl::enums::MessageAction>>> {
    'retry: loop {
        let mut out = Vec::with_capacity(2);
        let mut messages = client.iter_messages(peer).limit(2);
        loop {
            match messages.next().await {
                Ok(Some(message)) => out.push(message.action().cloned()),
                Ok(None) => return Ok(out),
                Err(e) => {
                    wait_if_rate_limited(e, on_event).await?;
                    continue 'retry;
                }
            }
        }
    }
}
