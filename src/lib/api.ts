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

export type LoginStep = { step: "done" } | { step: "passwordNeeded"; hint: string | null };

export type ScanEvent =
  | { event: "progress"; checked: number }
  | { event: "rateLimited"; seconds: number };

export interface ChatSummary {
  id: string;
  /** Empty for deleted accounts; the UI shows "Deleted Account". */
  name: string;
  deletedAccount: boolean;
  /** Unix seconds of the join notice. */
  date: number;
}

export interface ScanResult {
  checked: number;
  joinOnly: ChatSummary[];
}

export interface Api {
  restoreSession(): Promise<boolean>;
  requestCode(phone: string): Promise<void>;
  submitCode(code: string): Promise<LoginStep>;
  submitPassword(password: string): Promise<void>;
  scan(onEvent: (event: ScanEvent) => void): Promise<ScanResult>;
  logOut(): Promise<void>;
}

const tauriApi: Api = {
  restoreSession: () => invoke("restore_session"),
  requestCode: (phone) => invoke("request_code", { phone }),
  submitCode: (code) => invoke("submit_code", { code }),
  submitPassword: (password) => invoke("submit_password", { password }),
  scan: (onEvent) => {
    const channel = new Channel<ScanEvent>();
    channel.onmessage = onEvent;
    return invoke("scan", { onEvent: channel });
  },
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
