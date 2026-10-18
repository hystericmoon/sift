import { describe, expect, it } from "vitest";
import { displayName, formatWait, initials, plural, rowLabel } from "./format";
import { countSelected, nextIndex, selectAll, selectNone, toggle } from "./selection";

const chat = (name: string, deletedAccount = false) => ({
  id: "1",
  name,
  deletedAccount,
  hasPhoto: false,
  date: Date.UTC(2024, 3, 19, 12) / 1000,
});

describe("format", () => {
  it("falls back to Deleted Account", () => {
    expect(displayName(chat(""))).toBe("Deleted Account");
    expect(displayName(chat("Ankie", true))).toBe("Deleted Account");
    expect(displayName(chat("Ankie Aulia"))).toBe("Ankie Aulia");
  });

  it("builds initials from first and last word", () => {
    expect(initials(chat("Ankie Aulia"))).toBe("AA");
    expect(initials(chat("budi"))).toBe("B");
    expect(initials(chat("Maria de la Cruz"))).toBe("MC");
    expect(initials(chat("", true))).toBe("–");
  });

  it("names rows the way the brief asks", () => {
    expect(rowLabel(chat("Ankie Aulia"))).toBe("Ankie Aulia, joined 19 April 2024");
  });

  it("states counts precisely", () => {
    expect(plural(1, "chat", "chats")).toBe("1 chat");
    expect(plural(1650, "chat", "chats")).toBe("1,650 chats");
  });

  it("formats waits", () => {
    expect(formatWait(30)).toBe("30s");
    expect(formatWait(600)).toBe("10 min");
    expect(formatWait(7200)).toBe("2 h");
  });
});

describe("selection", () => {
  const ids = ["a", "b", "c"];

  it("toggles, selects all and none", () => {
    let s = selectAll(new Set(), ids);
    expect(countSelected(s, ids)).toBe(3);
    s = toggle(s, "b");
    expect([...s].sort()).toEqual(["a", "c"]);
    s = selectNone(s, ids);
    expect(countSelected(s, ids)).toBe(0);
  });

  it("only touches the given list", () => {
    const s = selectNone(new Set(["a", "x"]), ids);
    expect([...s]).toEqual(["x"]);
  });

  it("moves through rows with the keyboard", () => {
    expect(nextIndex("ArrowDown", 0, 3)).toBe(1);
    expect(nextIndex("ArrowDown", 2, 3)).toBe(2);
    expect(nextIndex("ArrowUp", 0, 3)).toBe(0);
    expect(nextIndex("End", 0, 3)).toBe(2);
    expect(nextIndex("Home", 2, 3)).toBe(0);
    expect(nextIndex("a", 0, 3)).toBeNull();
    expect(nextIndex("ArrowDown", 0, 0)).toBeNull();
  });
});
