//! Sift spike: a read-only check that grammers covers what Sift needs.
//!
//!   cargo run --release              log in, scan, list matching chats
//!   cargo run --release -- dry-run   also re-check each match and pace it like a
//!                                    delete, without deleting anything
//!   cargo run --release -- logout    end the session and remove the local file
//!
//! This program contains no delete call at all.

mod detect;

use std::io::{self, BufRead as _, Write as _};
use std::sync::Arc;
use std::time::{Duration, Instant};

use grammers_client::peer::Peer;
use grammers_client::session::types::PeerRef;
use grammers_client::{Client, InvocationError, SignInError, tl};
use grammers_mtsender::{ConnectionParams, NoRetries, SenderPool};
use grammers_session::storages::SqliteSession;

use detect::{ChatKind, passes_cheap_check, passes_strict_check};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

const SESSION_FILE: &str = "sift-spike.session";
const DELETED_NAME: &str = "Deleted Account";

struct Candidate {
    peer: PeerRef,
    name: String,
    date: String,
    deleted: bool,
}

fn prompt(message: &str) -> Result<String> {
    print!("{message}");
    io::stdout().flush()?;
    let mut line = String::new();
    io::stdin().lock().read_line(&mut line)?;
    Ok(line.trim().to_string())
}

/// FLOOD_WAIT_n arrives as RPC error 420 with n in `value`.
fn flood_wait_secs(error: &InvocationError) -> Option<u64> {
    match error {
        InvocationError::Rpc(rpc) if rpc.code == 420 => Some(rpc.value.unwrap_or(5) as u64),
        _ => None,
    }
}

/// Visible countdown instead of a silent sleep, as the app UI will do.
async fn wait_out(secs: u64) {
    for left in (1..=secs).rev() {
        print!("\r  Waiting {left}s — Telegram's rate limit   ");
        io::stdout().flush().ok();
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    println!("\r  Resuming.                                   ");
}

async fn log_in(client: &Client, api_hash: &str) -> Result<()> {
    if client.is_authorized().await? {
        println!("Using the saved session in {SESSION_FILE}.");
        return Ok(());
    }

    let phone = prompt("Phone number with country code (e.g. +62...): ")?;
    let token = client.request_login_code(&phone, api_hash).await?;

    let mut code = prompt("Login code (sent inside the Telegram app): ")?;
    let mut result = client.sign_in(&token, &code).await;
    while let Err(SignInError::InvalidCode) = result {
        code = prompt("That code isn't right. Try again: ")?;
        result = client.sign_in(&token, &code).await;
    }

    match result {
        Ok(_) => {}
        Err(SignInError::PasswordRequired(mut password_token)) => loop {
            let hint = password_token.hint().unwrap_or("none").to_string();
            let password = rpassword::prompt_password(format!("2FA password (hint: {hint}): "))?;
            match client.check_password(password_token, password.trim()).await {
                Ok(_) => break,
                Err(SignInError::InvalidPassword(retry_token)) => {
                    println!("That password isn't right.");
                    password_token = retry_token;
                }
                Err(e) => return Err(e.into()),
            }
        },
        Err(e) => return Err(e.into()),
    }
    println!("Logged in.");
    Ok(())
}

/// Up to 2 latest message actions in a chat, retrying through rate limits.
async fn recent_actions(
    client: &Client,
    peer: PeerRef,
) -> Result<Vec<Option<tl::enums::MessageAction>>> {
    'retry: loop {
        let mut out = Vec::with_capacity(2);
        let mut messages = client.iter_messages(peer).limit(2);
        loop {
            match messages.next().await {
                Ok(Some(message)) => out.push(message.action().cloned()),
                Ok(None) => return Ok(out),
                Err(e) => match flood_wait_secs(&e) {
                    Some(secs) => {
                        wait_out(secs).await;
                        continue 'retry;
                    }
                    None => return Err(e.into()),
                },
            }
        }
    }
}

async fn scan(client: &Client) -> Result<(usize, Vec<Candidate>)> {
    let mut checked = 0;
    let mut candidates = Vec::new();
    let mut dialogs = client.iter_dialogs();

    loop {
        let dialog = match dialogs.next().await {
            Ok(Some(dialog)) => dialog,
            Ok(None) => break,
            Err(e) => match flood_wait_secs(&e) {
                Some(secs) => {
                    wait_out(secs).await;
                    continue;
                }
                None => return Err(e.into()),
            },
        };
        checked += 1;
        if checked % 25 == 0 {
            print!("\r  {checked} chats checked");
            io::stdout().flush().ok();
        }

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
        if !passes_strict_check(&recent_actions(client, dialog.peer_ref()).await?) {
            continue;
        }

        let name = if deleted || name.trim().is_empty() { DELETED_NAME.to_string() } else { name };
        let date = last.map(|m| m.date().strftime("%d/%m/%y").to_string()).unwrap_or_default();
        candidates.push(Candidate { peer: dialog.peer_ref(), name, date, deleted });
    }
    println!("\r  {checked} chats checked");
    Ok((checked, candidates))
}

/// Everything a real delete does except the delete itself.
async fn dry_run(client: &Client, candidates: &[Candidate]) -> Result<()> {
    let total = candidates.len();
    let (mut would_delete, mut skipped) = (0, 0);
    println!("\nDry run: re-checking each chat at about one per second. Nothing is deleted.");
    for (i, c) in candidates.iter().enumerate() {
        if passes_strict_check(&recent_actions(client, c.peer).await?) {
            would_delete += 1;
            println!("  [{}/{total}] would delete  {}", i + 1, c.name);
        } else {
            skipped += 1;
            println!("  [{}/{total}] skipped       {} (no longer only a join notice)", i + 1, c.name);
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    println!("\nDry run done: {would_delete} would be deleted, {skipped} skipped, 0 failed.");
    Ok(())
}

async fn async_main() -> Result<()> {
    let mode = std::env::args().nth(1).unwrap_or_default();
    dotenvy::dotenv().map_err(|_| "No .env found. Copy .env.example to .env in the Sift folder and fill it in.")?;
    let api_id: i32 = std::env::var("SIFT_API_ID")?.trim().parse().map_err(|_| "SIFT_API_ID must be a number")?;
    let api_hash = std::env::var("SIFT_API_HASH")?.trim().to_string();

    let session = Arc::new(SqliteSession::open(SESSION_FILE).await?);
    let params = ConnectionParams {
        device_model: "Sift spike".into(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        // Hand FLOOD_WAIT back to us so we can show a countdown.
        retry_policy: Box::new(NoRetries),
        ..Default::default()
    };
    let SenderPool { runner, handle, .. } = SenderPool::with_configuration(Arc::clone(&session), api_id, params);
    let client = Client::new(handle);
    tokio::spawn(runner.run());

    if mode == "logout" {
        if client.is_authorized().await? {
            client.sign_out().await?;
        }
        drop(client);
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let _ = std::fs::remove_file(format!("{SESSION_FILE}{suffix}"));
        }
        println!("Logged out. The local session file is removed.");
        return Ok(());
    }

    log_in(&client, &api_hash).await?;

    println!("\nScanning your chats (read-only)...");
    let started = Instant::now();
    let (checked, candidates) = scan(&client).await?;
    let deleted_accounts = candidates.iter().filter(|c| c.deleted).count();

    println!(
        "\nChecked {checked} chats in {:.1}s. Joined Telegram only · {} ({deleted_accounts} from deleted accounts)\n",
        started.elapsed().as_secs_f32(),
        candidates.len()
    );
    for c in &candidates {
        println!("  {}  {}", c.date, c.name);
    }
    if candidates.is_empty() {
        println!("Nothing to clear. Your chat list is already clean.");
    } else if mode == "dry-run" {
        dry_run(&client, &candidates).await?;
    }
    Ok(())
}

fn main() -> Result<()> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(async_main())
}
