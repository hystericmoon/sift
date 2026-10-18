# Sift

Sift is a desktop app for macOS and Windows. It removes the chats in a Telegram account whose only message is the "joined Telegram" notice, and leaves real conversations alone.

Sift uses the Telegram API and is not affiliated with Telegram.

- **Read-only until you confirm.** The scan only reads. Nothing is deleted until you review the list and confirm.
- **Exact match.** A chat qualifies only if its single message is Telegram's `MessageActionContactSignUp` service action. Sift never matches on message text.
- **For you only.** Deletes use `messages.deleteHistory` with `revoke: false`, so the other person's copy and your contacts stay.
- **Local.** There are no servers, telemetry or analytics. The login session lives in the OS credential store.

The product brief is in [docs/SIFT_BRIEF.md](docs/SIFT_BRIEF.md). The Python script the detection logic was ported from is [docs/tg_join_cleaner.py](docs/tg_join_cleaner.py).

## Stack

| Layer | Choice |
| --- | --- |
| Shell | Tauri 2: Rust back-end, system WebView (WKWebView on macOS, WebView2 on Windows) |
| Telegram | [grammers](https://codeberg.org/Lonami/grammers) 0.11 (MTProto, by the author of Telethon) |
| UI | React 19 + TypeScript + Vite |
| Session storage | `keyring`: macOS Keychain, Windows Credential Manager |
| Fonts | Geist, Geist Mono, Slackey, bundled in `src/assets/fonts` (OFL) |

The Rust side owns all Telegram access. The page can only call the commands in [src-tauri/src/lib.rs](src-tauri/src/lib.rs), and it never sees the session or the API keys.

## Setup

1. Install Node 22+ and Rust (`rustup`, stable).
2. `npm install`
3. Copy `.env.example` to `.env` and fill in `SIFT_API_ID` and `SIFT_API_HASH` from [my.telegram.org](https://my.telegram.org) → API development tools. `.env` is git-ignored, and so is any `.env.*` copy.

The keys are compiled into the binary by [src-tauri/build.rs](src-tauri/build.rs). In CI they come from repository secrets with the same names.

## Develop

```bash
npm run tauri dev        # the real app, talking to Telegram (dry run, see below)
npm run dev              # UI only, in a browser, with fake data
npm test                 # TypeScript unit tests (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust unit tests
```

### Dry run

Development builds never delete anything. They run every step, including the re-check and pacing, but skip the delete call itself. A "Dry run · nothing is deleted" badge appears on every screen where a delete could happen.

| Build | Default | Override |
| --- | --- | --- |
| `tauri dev` (debug) | dry run | `SIFT_DRY_RUN=0 npm run tauri dev` deletes for real |
| `tauri build` (release) | deletes for real | `SIFT_DRY_RUN=1` forces a dry run |

Only run a real delete against an account when its owner has explicitly agreed.

### Keychain prompts on macOS

Unsigned builds get a new code signature on every rebuild. macOS may then ask whether Sift can use its saved login in the Keychain. Choose "Always Allow", or deny it and log in again. Signed release builds keep one identity, so users won't see this.

### Reviewing screens with fake data

`npm run dev` opens the UI at http://localhost:1420 with a fake back-end ([src/lib/mock.ts](src/lib/mock.ts)). It never talks to Telegram and is excluded from production builds. Login code `12345`, 2FA password `sift`. URL options:

| URL | Shows |
| --- | --- |
| `?mock=results&session=1` | 12 matches, skipping login |
| `?mock=many&session=1` | 165 matches |
| `?mock=empty&session=1` | Empty state |
| `?mock=ratelimit&session=1` | Rate-limit countdown during scan and delete |
| `?mock=offline` | Network error at login |
| `&dry=0` | Real-delete wording |

## Build installers

```bash
# macOS, universal (Apple Silicon + Intel). Needs: rustup target add x86_64-apple-darwin
CI=true npm run tauri build -- --target universal-apple-darwin --bundles app,dmg
# → src-tauri/target/universal-apple-darwin/release/bundle/dmg/Sift_0.1.0_universal.dmg
```

Windows installers are built on Windows or in CI: [.github/workflows/build.yml](.github/workflows/build.yml) tests, then builds the macOS `.dmg` and the Windows NSIS `.exe` as downloadable artifacts. Add `SIFT_API_ID` and `SIFT_API_HASH` as repository secrets first.

Builds are **unsigned** for now. On macOS, the first launch needs right-click → Open. On Windows, SmartScreen shows "More info → Run anyway".

## How it works

```
src-tauri/src/
  detect.rs         Detection rules (ported 1:1 from the Python script) + categories
  telegram.rs       Login, scan, avatars, delete with re-check, rate limits
  session_store.rs  Session in the OS credential store
  lib.rs            Tauri commands; the only API the page can call
src/
  screens/          Intro → Login → Scan → Results → (Confirm) → Deleting → Summary
  components/       Avatar, ConfirmDialog, DryRunBadge
  lib/              Typed bridge, copy and formatting, selection logic, fake back-end
  styles/           Brand tokens (dark default, light follows the OS) and base styles
```

**Detection rules** ([detect.rs](src-tauri/src/detect.rs)):
1. Only private chats with real users. Groups, channels, bots and Saved Messages are skipped.
2. The latest message must be the `MessageActionContactSignUp` service action.
3. Fetching 2 messages must return only that one.
4. Deleted accounts that meet 1–3 are included.

**Categories.** The results screen, scan and re-check all work per `Category`. Today there is one, `JoinedOnly`. Planned filters ("deleted accounts with history", "inactive for N months") become new variants with their own `may_match` / `confirm` rules and copy in [format.ts](src/lib/format.ts).

**Deleting.** For each selected chat, Sift fetches the latest 2 messages and runs the category's rule again. If the chat changed, it's skipped and reported. Then it calls `messages.deleteHistory` (`revoke: false`). Chats are paced at about one per second. A `FLOOD_WAIT` shows a countdown and resumes by itself. "Stop after this chat" stops cleanly, and three network failures in a row stop the run.

**Session.** Only the home datacenter id, its address and its auth key are saved, as one Keychain / Credential Manager entry (service `app.sift.desktop`). "Log out and remove session" signs the session out with Telegram and deletes that entry.

## Telegram API rules followed

- Sift has its own `api_id` / `api_hash`, never shown to or entered by users.
- The window title and product name are "Sift", never containing "Telegram". There's no Telegram logo and no Telegram blue.
- The intro screen and the store description say: "Sift uses the Telegram API and is not affiliated with Telegram."

## Before the first public release

- [ ] Pick the final bundle identifier in `src-tauri/tauri.conf.json` (now `app.sift.desktop`; use a reverse-DNS name you own) and the matching `SERVICE` in `session_store.rs`. Changing it later logs existing users out once.
- [ ] Set `publisher` and `copyright` in `tauri.conf.json`.
- [ ] Code signing and notarization: an Apple Developer ID plus notarytool, and a Windows code-signing certificate.
- [ ] Test a real delete on an account whose owner agreed, in a release build or with `SIFT_DRY_RUN=0`.
- [ ] Store listing: see [docs/STORE_LISTING.md](docs/STORE_LISTING.md).
