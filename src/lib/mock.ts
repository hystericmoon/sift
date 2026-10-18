// Fake backend for reviewing screens in a browser. Never used inside the app,
// and never talks to Telegram.
//
// URL options (combine with &):
//   mock=results (default) | empty | many | ratelimit | restored | offline
//   session=1   start as if a saved session exists (skips login)
//   dry=0       show real-delete copy (the mock never deletes anything)
// Login code: 12345. 2FA password: sift (anything else shows the error).
// In the delete step, "Budi Santoso" gets a new message (skipped) and
// "Citra Lestari" fails, so the summary shows both cases.

import type { Api, ChatSummary, DeleteReport, Outcome, UiError } from "./api";

const params = new URLSearchParams(window.location.search);
const scenario = params.get("mock") ?? "results";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (error: UiError) => Promise.reject(error);

const baseNames = [
  "Ankie Aulia",
  "",
  "Budi Santoso",
  "Citra Lestari",
  "",
  "Dewi Kartika",
  "Eko Prasetyo",
  "Fajar Nugroho",
  "Gita Permata",
  "Hendra Wijaya",
  "Indah Sari",
  "Joko Susilo",
];

function makeChats(): ChatSummary[] {
  const count = scenario === "many" ? 165 : scenario === "empty" ? 0 : baseNames.length;
  return Array.from({ length: count }, (_, i) => {
    const name = baseNames[i % baseNames.length];
    const suffix = i >= baseNames.length && name ? ` ${Math.floor(i / baseNames.length) + 1}` : "";
    return {
      id: String(1000 + i),
      name: name ? name + suffix : "",
      deletedAccount: name === "",
      hasPhoto: name !== "" && i % 3 === 0,
      date: Date.UTC(2024, 3, 19) / 1000 - i * 86400 * 7,
    };
  });
}

const chats = makeChats();

function avatarSvg(name: string, hue: number): string {
  const letter = name[0] ?? "?";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${hue} 35% 38%)"/><text x="32" y="42" font-family="sans-serif" font-size="28" fill="white" text-anchor="middle">${letter}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

let stopRequested = false;

export const mockApi: Api = {
  async appInfo() {
    return { dryRun: params.get("dry") !== "0", version: "0.1.0-mock" };
  },
  async restoreSession() {
    await sleep(200);
    return scenario === "restored" || params.get("session") === "1";
  },
  async requestCode(phone) {
    await sleep(500);
    if (scenario === "offline") return fail({ kind: "network" });
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
    return { checked: total, categories: [{ category: "joinedOnly", chats }] };
  },
  async loadAvatars(onEvent) {
    for (const [i, chat] of chats.entries()) {
      if (!chat.hasPhoto) continue;
      await sleep(120);
      onEvent({ id: chat.id, dataUrl: avatarSvg(chat.name, (i * 47) % 360) });
    }
  },
  async deleteChats(ids, onEvent) {
    stopRequested = false;
    const report: DeleteReport = {
      dryRun: params.get("dry") !== "0",
      total: ids.length,
      deleted: 0,
      notDeleted: [],
      stopped: false,
      connectionLost: false,
    };
    for (const [i, id] of ids.entries()) {
      if (stopRequested) {
        report.stopped = true;
        break;
      }
      const index = i + 1;
      onEvent({ event: "started", index, total: ids.length, id });
      if (scenario === "ratelimit" && index === 3) {
        onEvent({ event: "rateLimited", seconds: 5 });
        await sleep(5000);
      }
      await sleep(scenario === "many" ? 60 : 450);
      const name = chats.find((c) => c.id === id)?.name ?? "";
      const outcome: Outcome = name.startsWith("Budi")
        ? { result: "skipped", reason: { kind: "newMessages" } }
        : name.startsWith("Citra")
          ? { result: "failed", reason: { kind: "telegram", code: "PEER_ID_INVALID" } }
          : { result: "deleted" };
      if (outcome.result === "deleted") report.deleted += 1;
      else report.notDeleted.push({ id, outcome });
      onEvent({ event: "finished", index, total: ids.length, id, outcome });
      if (index < ids.length) await sleep(scenario === "many" ? 20 : 400);
    }
    return report;
  },
  async stopDeleting() {
    stopRequested = true;
  },
  async logOut() {
    await sleep(300);
  },
};
