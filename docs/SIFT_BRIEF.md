# Sift: build brief

Sift is a desktop app (macOS + Windows) that removes "X joined Telegram" chats from a user's Telegram account in one pass, without touching real conversations.

Read this whole brief, then propose a plan and stack confirmation before writing code.

## Reference implementation

`tg_join_cleaner.py` (in this folder) is a working Python/Telethon script, tested on a real account. It is the source of truth for detection logic. Port its behaviour exactly.

Detection rules:
1. Only private chats with real users (skip groups, channels, bots, Saved Messages).
2. The chat's latest message must be a service message with action `MessageActionContactSignUp`. Never match on text.
3. Fetch up to 2 messages; the join notice must be the only message.
4. Chats with deleted accounts that meet rules 1–3 are included.

Delete with `revoke = false` (removes the chat for the user only).

## Suggested stack (confirm or challenge)

- Electron + React + TypeScript for the UI.
- GramJS (`telegram` on npm) for MTProto. Its API closely mirrors Telethon, so the script ports nearly line by line.
- Session string stored locally and encrypted with Electron `safeStorage`. No servers, no telemetry, no analytics.
- Fonts bundled locally (no Google Fonts CDN) so the app works offline.
- electron-builder for a macOS universal `.dmg` and a Windows installer. Code signing comes later.

If you recommend Tauri or another stack instead, explain the trade-off first.

## Telegram API rules (must follow)

- Register our own `api_id` / `api_hash` at my.telegram.org. Users never see or enter them. Read them from a local `.env` during development, and never commit them.
- The app title must never contain the word "Telegram". Never use the Telegram logo or Telegram blue.
- The intro screen and store description must state: "Sift uses the Telegram API and is not affiliated with Telegram."

## Flow and screens

1. **Intro.** Wordmark, one-line value prop, the disclosure line, and a "Log in to start" button.
2. **Login.** Phone number with country code, then the login code (sent inside the Telegram app), then the 2FA password if the account has one. Show clear errors for a wrong code or password.
3. **Scan.** Read-only. Show a live count ("412 chats checked"). Nothing is deleted at this stage.
4. **Results.**
   - Show the category with its count, e.g. "Joined Telegram only · 165".
   - Below it, a list of chats with avatar or initials, name ("Deleted Account" fallback) and date. All rows are checked by default and each can be unticked.
   - Provide select all / none.
   - Empty state: "Nothing to clear. Your chat list is already clean."
5. **Confirm dialog.**
   - Title: "Delete 165 chats?"
   - Body: "Each one holds only a join notice. They're removed for you only, and your contacts stay. This can't be undone."
   - Buttons: "Cancel" and "Delete 165 chats". The count updates with the selection.
6. **Deleting.**
   - Show progress as "[i]/[n]".
   - Before deleting each chat, re-check that it still holds only the join notice; if it doesn't, skip it and report that.
   - Pace deletes at about one per second.
   - On FloodWait, show "Waiting 30s — Telegram's rate limit" with a countdown, never a frozen UI.
7. **Summary.**
   - Report deleted, skipped and failed counts, with a short list of failures and reasons.
   - Buttons: "Scan again" and "Log out and remove session". The second logs out of the Telegram session and deletes local data.

Future filters (design for them, don't build yet): chats with deleted accounts that have history; chats inactive for over N months.

## Brand

The voice is precise, calm and transparent. Always state the number and the thing. Never use hype or destruction verbs ("nuke", "wipe out"). Always say what stays untouched.

Wordmark: "Sift" set in **Slackey**, used only for the wordmark. The app icon is a Slackey "S" in Bone on Graphite. Everything else uses **Geist** (400/500/600). **Geist Mono** is used for counts, dates and labels, with tabular numerals.

Dark theme is the default; light theme follows the OS.

```css
:root {
  /* dark (default) */
  --bg: #0E0F10;            /* Ink */
  --surface: #17191B;       /* Graphite */
  --divider: #2A2D30;       /* Rule, decorative only */
  --border-control: #70767C;/* inputs, checkboxes: 4.2:1 */
  --text-secondary: #9BA1A7;/* Mist: 7.4:1 */
  --text: #ECEDEE;          /* Bone: 16.4:1 */
  --accent: #C6F432;        /* Signal: focus rings, primary fills; Ink text on it */
  --accent-text: #C6F432;
  --danger: #FF6B47;        /* Ember: Ink text on it, 6.8:1 */
  --on-danger: #0E0F10;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #F4F4F2;          /* Paper */
    --surface: #FFFFFF;
    --divider: #E2E3E1;
    --border-control: #7A8086; /* 3.6:1 */
    --text-secondary: #5B6066; /* Slate: 5.8:1 */
    --text: #0E0F10;
    --accent: #4A6600;      /* Signal Deep; Signal fails on light */
    --accent-text: #4A6600;
    --danger: #B8361A;      /* Ember Deep: white text 5.9:1 */
    --on-danger: #FFFFFF;
  }
}
```

Type scale (size/line height · weight):
- Display 48/52 · 600
- Title 24/32 · 600
- Heading 17/24 · 500
- Body 15/22 · 400
- Small 13/18 · 400
- Mono label 12/16 · 500, uppercase, 0.08em tracking

## Accessibility (required)

- Full keyboard operation:
  - Tab order follows the visual order.
  - Space toggles a row.
  - Cmd/Ctrl+A selects all in the list.
  - Esc cancels dialogs.
  - Focus moves into the confirm dialog and returns to the trigger when it closes.
- Visible focus ring: 2px `--accent` with an offset.
- Every checkbox has an accessible name, e.g. "Ankie Aulia, joined 19 April 2024".
- Scan and delete progress are announced through an `aria-live="polite"` region.
- Text contrast is ≥ 4.5:1, and control borders and icons are ≥ 3:1, using the tokens above.
- Primary buttons are at least 44px tall.

## Working agreement

Build in milestones, and stop for review after each:
1. Project scaffold, login, and a read-only scan that prints results.
2. Results UI with selection, plus the empty state.
3. Confirm dialog, deletion with re-check, rate-limit handling, and the summary.
4. Light theme polish, packaging for macOS and Windows.

Never run a real delete against the account without the user explicitly approving it in chat. Use a dry-run mode for development.
