// Typed bridge to the Rust side (src-tauri/src/lib.rs). The UI never sees the
// session or API keys; it only gets these summaries and errors.

import { Channel, invoke } from "@tauri-apps/api/core";
import { mockApi } from "./mock";

export type UiError =
  | { kind: "missingApiKeys" }
  | { kind: "invalidPhone" }
  | { kind: "invalidCode" }
  | { kind: "codeExpired" }
  | { kind: "invalidPassword" }
  | { kind: "needsSignUp" }
  | { kind: "notLoggedIn" }
  | { kind: "rateLimited"; seconds: number }
  | { kind: "network" }
  | { kind: "other"; message: string };

export interface AppInfo {
  /** True when deletes are simulated (always in development builds). */
  dryRun: boolean;
  version: string;
}

export type LoginStep = { step: "done" } | { step: "passwordNeeded"; hint: string | null };

export type ScanEvent =
  | { event: "progress"; checked: number }
  | { event: "rateLimited"; seconds: number };

/** Kinds of chats Sift can clear. More filters will be added here. */
export type Category = "joinedOnly";

export interface ChatSummary {
  id: string;
  /** Empty for deleted accounts; the UI shows "Deleted Account". */
  name: string;
  deletedAccount: boolean;
  hasPhoto: boolean;
  /** Unix seconds of the join notice. */
  date: number;
}

export interface CategoryResult {
  category: Category;
  chats: ChatSummary[];
}

export interface ScanResult {
  checked: number;
  categories: CategoryResult[];
}

export interface AvatarEvent {
  id: string;
  dataUrl: string;
}

export type SkipReason = { kind: "newMessages" } | { kind: "alreadyGone" } | { kind: "notInScan" };
export type FailReason = { kind: "network" } | { kind: "telegram"; code: string };

export type Outcome =
  | { result: "deleted" }
  | { result: "skipped"; reason: SkipReason }
  | { result: "failed"; reason: FailReason };

export type DeleteEvent =
  | { event: "started"; index: number; total: number; id: string }
  | { event: "finished"; index: number; total: number; id: string; outcome: Outcome }
  | { event: "rateLimited"; seconds: number };

export interface ChatOutcome {
  id: string;
  outcome: Outcome;
}

export interface DeleteReport {
  dryRun: boolean;
  total: number;
  deleted: number;
  notDeleted: ChatOutcome[];
  stopped: boolean;
  connectionLost: boolean;
}

export interface Api {
  appInfo(): Promise<AppInfo>;
  restoreSession(): Promise<boolean>;
  requestCode(phone: string): Promise<void>;
  submitCode(code: string): Promise<LoginStep>;
  submitPassword(password: string): Promise<void>;
  scan(onEvent: (event: ScanEvent) => void): Promise<ScanResult>;
  loadAvatars(onEvent: (event: AvatarEvent) => void): Promise<void>;
  deleteChats(ids: string[], onEvent: (event: DeleteEvent) => void): Promise<DeleteReport>;
  stopDeleting(): Promise<void>;
  logOut(): Promise<void>;
}

function channel<T>(onEvent: (event: T) => void): Channel<T> {
  const c = new Channel<T>();
  c.onmessage = onEvent;
  return c;
}

const tauriApi: Api = {
  appInfo: () => invoke("app_info"),
  restoreSession: () => invoke("restore_session"),
  requestCode: (phone) => invoke("request_code", { phone }),
  submitCode: (code) => invoke("submit_code", { code }),
  submitPassword: (password) => invoke("submit_password", { password }),
  scan: (onEvent) => invoke("scan", { onEvent: channel(onEvent) }),
  loadAvatars: (onEvent) => invoke("load_avatars", { onEvent: channel(onEvent) }),
  deleteChats: (ids, onEvent) => invoke("delete_chats", { ids, onEvent: channel(onEvent) }),
  stopDeleting: () => invoke("stop_deleting"),
  logOut: () => invoke("log_out"),
};

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Outside the app window (plain `npm run dev` in a browser), use fake data so
// the screens can be reviewed without a Telegram account. Production builds
// always use the real bridge, and the mock is dropped from the bundle.
export const api: Api = inTauri || !import.meta.env.DEV ? tauriApi : mockApi;

export function isUiError(value: unknown): value is UiError {
  return typeof value === "object" && value !== null && "kind" in value;
}

export function asUiError(value: unknown): UiError {
  return isUiError(value) ? value : { kind: "other", message: String(value) };
}
