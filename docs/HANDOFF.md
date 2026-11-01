# Handoff: project state (2026-11-01)

The conversation that built Sift is gone. This file is what a new session (or a new person) needs to know. Read it with [SIFT_BRIEF.md](SIFT_BRIEF.md), the original product brief, and [DEVELOPMENT.md](DEVELOPMENT.md), the setup and architecture notes.

## Where things stand

- **All 4 milestones in the brief are built** and on `main` at https://github.com/hystericmoon/sift (public, MIT).
- **Release v0.1.0 is a DRAFT** on GitHub with `Sift_0.1.0_universal.dmg` (macOS) and `Sift_0.1.0_x64-setup.exe` (Windows). It isn't public until the owner clicks Publish on the Releases page. Don't publish it without the owner's go-ahead.
- **CI** ([.github/workflows/build.yml](../.github/workflows/build.yml)):
  - Pull requests run the tests only.
  - Pushes to `main` also build both installers as workflow artifacts.
  - A `v*` tag builds both installers and attaches them to a draft release.
  - The repo secrets `SIFT_API_ID` and `SIFT_API_HASH` are set.
- **Tests:** 11 Rust (`cargo test --manifest-path src-tauri/Cargo.toml`) and 8 TypeScript (`npm test`), plus `npx tsc`. All pass.

## Not yet verified

1. **A real delete end to end.** Only dry run and the fake back-end have exercised the delete path. The owner's own Telegram account has 0 matching chats (they cleared them earlier with the Python script), so an empty scan there is expected, not a bug.
2. **The Windows installer.** It built on CI, but nobody has run it on a Windows PC.
3. **Code signing.** Deliberately deferred (see the brief). Installers are unsigned: macOS needs "Open Anyway" in Privacy & Security, and Windows SmartScreen needs "More info → Run anyway".

## Rules to keep

- **Never run a real delete against an account without the owner's explicit approval in chat.** Debug builds are dry runs unless `SIFT_DRY_RUN=0`. Release builds delete for real once the user confirms in the app.
- **API keys never go in the repo.** Locally they're in `.env` (git-ignored, as is any `.env.*`). In CI they come from repo secrets. An agent must not type or set the keys itself; the owner runs `gh secret set -f .env --repo hystericmoon/sift`.
- **Commits use `hosnirachmani <hosnirachmani@gmail.com>`** (the owner's choice for the public history). Don't use the hyperscal.com address.
- **Telegram API rules (from the brief):**
  - The app title never contains "Telegram".
  - No Telegram logo and no Telegram blue.
  - Keep the line "Sift uses the Telegram API and is not affiliated with Telegram." on the intro screen and in store and release text.
- **Brand voice:** precise and calm. Always state the number and the thing, and say what stays untouched. No hype or destruction verbs.

## Key decisions already made

- **Stack:** Tauri 2 + Rust + grammers 0.11 (not the brief's Electron + GramJS suggestion), chosen for size; the macOS download is about 4.6 MB. A read-only CLI in `spike/` validated grammers against the real account first.
- **App ID** `io.github.hystericmoon.sift`. It's also the Keychain / Credential Manager service name in `src-tauri/src/session_store.rs`. Changing it logs users out once.
- **Session:** only the home DC's id, address and auth key are stored, in the OS credential store, never in a file.
- **Delete:** `messages.deleteHistory` with `revoke: false`. Each chat is re-checked right before deletion, and deletes run about one per second. FLOOD_WAIT shows a countdown in the UI; the retry policy deliberately hands 420 errors back instead of sleeping silently.
- **Future filters** ("deleted accounts with history", "inactive N months") go in as new `Category` variants in `src-tauri/src/detect.rs`, plus copy in `src/lib/format.ts`.
- **Screenshots** in `docs/screenshots/` are generated from the fake back-end (`npm run dev`, `?mock=many&session=1&dry=0&clean=1`), so they contain no real account data.

## Possible next steps

- The owner reviews the draft v0.1.0 release and publishes it.
- Test the Windows installer on a real PC.
- Test a real delete on a consenting account that has join-only chats.
- Code signing: Apple Developer ID plus notarization, and a Windows certificate. Wire both into CI.
- Version bumps go in three places: `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`. Then tag `vX.Y.Z`.
