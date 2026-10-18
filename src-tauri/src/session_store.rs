//! Keeps the login session in the OS credential store (macOS Keychain,
//! Windows Credential Manager), never in a plain file.
//!
//! Only the home datacenter and its auth key are saved. Everything else
//! grammers caches (peers, update state) is rebuilt on the next scan, and the
//! entry stays well under Windows' 2,560-byte credential limit.

use std::net::{SocketAddrV4, SocketAddrV6};

use grammers_session::Session as _;
use grammers_session::storages::MemorySession;
use grammers_session::types::DcOption;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "app.sift.desktop";
const ACCOUNT: &str = "session";

#[derive(Serialize, Deserialize)]
struct Stored {
    dc: i32,
    ipv4: String,
    ipv6: String,
    /// Hex-encoded 256-byte auth key.
    key: String,
}

fn entry() -> keyring::Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, ACCOUNT)
}

/// Builds a session, restored from the credential store when one is saved.
/// A missing or unreadable entry gives a fresh, logged-out session.
/// The flag says whether a saved session was restored.
pub async fn load() -> (MemorySession, bool) {
    let session = MemorySession::default();
    let Some(stored) = entry()
        .and_then(|e| e.get_password())
        .ok()
        .and_then(|json| serde_json::from_str::<Stored>(&json).ok())
    else {
        return (session, false);
    };
    let (Ok(ipv4), Ok(ipv6), Some(auth_key)) = (
        stored.ipv4.parse::<SocketAddrV4>(),
        stored.ipv6.parse::<SocketAddrV6>(),
        decode_key(&stored.key),
    ) else {
        return (session, false);
    };

    let option = DcOption { id: stored.dc, ipv4, ipv6, auth_key: Some(auth_key) };
    // MemorySession never fails these calls.
    let _ = session.set_dc_option(&option).await;
    let _ = session.set_home_dc_id(stored.dc).await;
    (session, true)
}

/// Saves the home datacenter's auth key after a successful login.
pub fn save(session: &MemorySession) -> Result<(), String> {
    let dc = session.home_dc_id().map_err(|e| e.to_string())?;
    let option = session
        .dc_option(dc)
        .map_err(|e| e.to_string())?
        .ok_or("No datacenter for this session")?;
    let key = option.auth_key.ok_or("Session has no auth key")?;
    let stored = Stored {
        dc,
        ipv4: option.ipv4.to_string(),
        ipv6: option.ipv6.to_string(),
        key: encode_key(&key),
    };
    let json = serde_json::to_string(&stored).map_err(|e| e.to_string())?;
    entry().and_then(|e| e.set_password(&json)).map_err(|e| e.to_string())
}

/// Removes the saved session. Succeeds when there was nothing to remove.
pub fn clear() -> Result<(), String> {
    match entry().and_then(|e| e.delete_credential()) {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn encode_key(key: &[u8; 256]) -> String {
    key.iter().map(|b| format!("{b:02x}")).collect()
}

fn decode_key(hex: &str) -> Option<[u8; 256]> {
    if hex.len() != 512 {
        return None;
    }
    let mut key = [0u8; 256];
    for (i, byte) in key.iter_mut().enumerate() {
        *byte = u8::from_str_radix(hex.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    Some(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_round_trips_through_hex() {
        let mut key = [0u8; 256];
        key.iter_mut().enumerate().for_each(|(i, b)| *b = i as u8);
        assert_eq!(decode_key(&encode_key(&key)), Some(key));
    }

    #[test]
    fn rejects_malformed_keys() {
        assert_eq!(decode_key("abc"), None);
        assert_eq!(decode_key(&"zz".repeat(256)), None);
    }
}
