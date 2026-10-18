//! Reads SIFT_API_ID / SIFT_API_HASH from the project's `.env` (or the build
//! environment, for CI) and bakes them into the binary. Users never see them.

use std::fs;

const KEYS: [&str; 2] = ["SIFT_API_ID", "SIFT_API_HASH"];

fn main() {
    println!("cargo:rerun-if-changed=../.env");
    for key in KEYS {
        println!("cargo:rerun-if-env-changed={key}");
    }

    let dotenv = fs::read_to_string("../.env").unwrap_or_default();
    for key in KEYS {
        let from_file = dotenv.lines().find_map(|line| {
            let (k, v) = line.split_once('=')?;
            (k.trim() == key).then(|| v.trim().trim_matches('"').to_string())
        });
        if let Some(value) = std::env::var(key).ok().or(from_file).filter(|v| !v.is_empty()) {
            println!("cargo:rustc-env={key}={value}");
        }
    }

    tauri_build::build()
}
