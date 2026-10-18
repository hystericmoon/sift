import type { ChatSummary, UiError } from "./api";

export const DELETED_ACCOUNT = "Deleted Account";

export function displayName(chat: ChatSummary): string {
  return chat.deletedAccount || !chat.name ? DELETED_ACCOUNT : chat.name;
}

export function initials(chat: ChatSummary): string {
  if (chat.deletedAccount || !chat.name) return "–";
  const parts = chat.name.trim().split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const longDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** "19 Apr 2024", for the visible list. */
export const formatDate = (unixSeconds: number) => shortDate.format(unixSeconds * 1000);

/** "19 April 2024", for accessible names. */
export const formatDateLong = (unixSeconds: number) => longDate.format(unixSeconds * 1000);

export function formatWait(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  return `${Math.ceil(minutes / 60)} h`;
}

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

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
      return "You're logged out. Log in again to continue.";
    case "rateLimited":
      return `Too many attempts. Telegram asks you to wait ${formatWait(error.seconds)} before trying again.`;
    case "network":
      return "Can't reach Telegram. Check your connection and try again.";
    case "other":
      return `Something went wrong: ${error.message}`;
  }
}
