import type { Category, ChatSummary, FailReason, Outcome, SkipReason, UiError } from "./api";

export const DELETED_ACCOUNT = "Deleted Account";

export function displayName(chat: Pick<ChatSummary, "name" | "deletedAccount">): string {
  return chat.deletedAccount || !chat.name.trim() ? DELETED_ACCOUNT : chat.name;
}

export function initials(chat: Pick<ChatSummary, "name" | "deletedAccount">): string {
  if (chat.deletedAccount || !chat.name.trim()) return "–";
  const parts = chat.name.trim().split(/\s+/);
  const first = Array.from(parts[0])[0] ?? "";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? "") : "";
  return (first + last).toUpperCase();
}

const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const longDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** "19 Apr 2024", for the visible list. */
export const formatDate = (unixSeconds: number) => shortDate.format(unixSeconds * 1000);

/** "19 April 2024", for accessible names. */
export const formatDateLong = (unixSeconds: number) => longDate.format(unixSeconds * 1000);

/** Accessible name for a row's checkbox, e.g. "Ankie Aulia, joined 19 April 2024". */
export const rowLabel = (chat: ChatSummary) => `${displayName(chat)}, joined ${formatDateLong(chat.date)}`;

export function formatWait(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  return `${Math.ceil(minutes / 60)} h`;
}

export const formatCount = (n: number) => n.toLocaleString("en-GB");

/** "1 chat", "165 chats". */
export const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

export const categoryCopy: Record<Category, { title: string; description: string }> = {
  joinedOnly: {
    title: "Joined Telegram only",
    description:
      "Each chat holds only the notice that this person joined Telegram. Chats with real messages aren't listed.",
  },
};

export function skipReasonText(reason: SkipReason): string {
  switch (reason.kind) {
    case "newMessages":
      return "A new message arrived after the scan, so it was left as is.";
    case "alreadyGone":
      return "Already removed.";
    case "notInScan":
      return "Not part of the latest scan. Scan again to include it.";
  }
}

export function failReasonText(reason: FailReason): string {
  switch (reason.kind) {
    case "network":
      return "Couldn't reach Telegram.";
    case "telegram":
      return `Telegram refused the request (${reason.code}).`;
  }
}

export function outcomeText(outcome: Outcome): string {
  switch (outcome.result) {
    case "deleted":
      return "Deleted.";
    case "skipped":
      return skipReasonText(outcome.reason);
    case "failed":
      return failReasonText(outcome.reason);
  }
}

/** Plain-language copy for each error the Rust side can return. */
export function errorMessage(error: UiError): string {
  switch (error.kind) {
    case "missingApiKeys":
      return "This build has no API keys. Add them to .env and rebuild.";
    case "invalidPhone":
      return "That number isn't recognised. Include the country code, for example +62.";
    case "invalidCode":
      return "That code isn't right. Check the latest code in the Telegram app.";
    case "codeExpired":
      return "That code has expired. Go back and request a new one.";
    case "invalidPassword":
      return "That password isn't right.";
    case "needsSignUp":
      return "This number has no Telegram account. Sift works with existing accounts only.";
    case "notLoggedIn":
      return "This session has ended, for example because it was closed from another device. Log in again to continue.";
    case "rateLimited":
      return `Too many attempts. Telegram asks you to wait ${formatWait(error.seconds)} before trying again.`;
    case "network":
      return "Can't reach Telegram. Check your connection and try again.";
    case "other":
      return `Something went wrong: ${error.message}`;
  }
}
