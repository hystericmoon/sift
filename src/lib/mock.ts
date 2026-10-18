// Fake backend for reviewing screens in a browser. Never used inside the app.
//
// URL options: ?mock=results (default) | empty | ratelimit | restored
// Login code: 12345. 2FA password: sift (any other value shows the error).

import type { Api, ChatSummary, UiError } from "./api";

const scenario = new URLSearchParams(window.location.search).get("mock") ?? "results";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (error: UiError) => Promise.reject(error);

const names = ["Ankie Aulia", "", "Budi Santoso", "Citra Lestari", "", "Dewi Kartika", "Eko Prasetyo"];
const sample: ChatSummary[] = names.map((name, i) => ({
  id: String(1000 + i),
  name,
  deletedAccount: name === "",
  date: Date.UTC(2024, 3, 19 - i * 9) / 1000,
}));

export const mockApi: Api = {
  async restoreSession() {
    await sleep(200);
    return scenario === "restored";
  },
  async requestCode(phone) {
    await sleep(500);
    if (phone.replace(/\D/g, "").length < 6) return fail({ kind: "invalidPhone" });
  },
  async submitCode(code) {
    await sleep(500);
    if (code.trim() !== "12345") return fail({ kind: "invalidCode" });
    return { step: "passwordNeeded", hint: "first pet" };
  },
  async submitPassword(password) {
    await sleep(600);
    if (password !== "sift") return fail({ kind: "invalidPassword" });
  },
  async scan(onEvent) {
    const total = 412;
    for (let checked = 1; checked <= total; checked += 3) {
      onEvent({ event: "progress", checked });
      if (scenario === "ratelimit" && checked === 202) {
        onEvent({ event: "rateLimited", seconds: 6 });
        await sleep(6000);
      }
      await sleep(8);
    }
    onEvent({ event: "progress", checked: total });
    return { checked: total, joinOnly: scenario === "empty" ? [] : sample };
  },
  async logOut() {
    await sleep(300);
  },
};
