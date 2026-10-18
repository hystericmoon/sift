// Selection is a set of chat ids. Helpers return new sets so React state
// updates stay simple.

export type Selection = ReadonlySet<string>;

export function toggle(selection: Selection, id: string): Selection {
  const next = new Set(selection);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function selectAll(selection: Selection, ids: readonly string[]): Selection {
  const next = new Set(selection);
  ids.forEach((id) => next.add(id));
  return next;
}

export function selectNone(selection: Selection, ids: readonly string[]): Selection {
  const next = new Set(selection);
  ids.forEach((id) => next.delete(id));
  return next;
}

export function countSelected(selection: Selection, ids: readonly string[]): number {
  return ids.reduce((n, id) => (selection.has(id) ? n + 1 : n), 0);
}

/** Next row index for list keyboard navigation, or null for keys the list ignores. */
export function nextIndex(key: string, current: number, length: number): number | null {
  if (length === 0) return null;
  switch (key) {
    case "ArrowDown":
      return Math.min(current + 1, length - 1);
    case "ArrowUp":
      return Math.max(current - 1, 0);
    case "Home":
      return 0;
    case "End":
      return length - 1;
    case "PageDown":
      return Math.min(current + 10, length - 1);
    case "PageUp":
      return Math.max(current - 10, 0);
    default:
      return null;
  }
}
