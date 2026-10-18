import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { CategoryResult, ChatSummary, ScanResult } from "../lib/api";
import { categoryCopy, displayName, formatCount, formatDate, plural, rowLabel } from "../lib/format";
import { countSelected, nextIndex, selectAll, selectNone, toggle, type Selection } from "../lib/selection";
import { useFocusOnMount } from "../lib/useFocusOnMount";
import { Avatar } from "../components/Avatar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DryRunBadge } from "../components/DryRunBadge";

interface Props {
  result: ScanResult;
  avatars: ReadonlyMap<string, string>;
  dryRun: boolean;
  onDelete: (chats: ChatSummary[]) => void;
  onScanAgain: () => void;
  onLogOut: () => void;
}

export function Results({ result, avatars, dryRun, onDelete, onScanAgain, onLogOut }: Props) {
  const groups = result.categories.filter((group) => group.chats.length > 0);
  const allChats = useMemo(() => groups.flatMap((group) => group.chats), [result]);
  // Every row starts checked.
  const [selection, setSelection] = useState<Selection>(() => new Set(allChats.map((chat) => chat.id)));
  const [confirming, setConfirming] = useState(false);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useFocusOnMount<HTMLHeadingElement>();

  const selected = allChats.filter((chat) => selection.has(chat.id));
  const checkedLabel = `${plural(result.checked, "chat", "chats")} checked · nothing deleted yet`;

  if (groups.length === 0) {
    return (
      <main className="screen">
        <div className="screen-header">
          <p className="t-label secondary">{checkedLabel}</p>
          <h1 className="t-title" ref={headingRef} tabIndex={-1}>
            Nothing to clear.
          </h1>
          <p className="t-body secondary">Your chat list is already clean.</p>
        </div>
        <div className="stack push-bottom">
          <button className="button button--primary button--block" onClick={onScanAgain}>
            Scan again
          </button>
          <button className="button button--secondary button--block" onClick={onLogOut}>
            Log out and remove session
          </button>
        </div>
      </main>
    );
  }

  function closeDialog() {
    setConfirming(false);
    // Return focus to the button that opened the dialog.
    requestAnimationFrame(() => deleteButtonRef.current?.focus());
  }

  const nothingSelected = selected.length === 0;

  return (
    <>
      <main className="screen screen--with-action-bar" inert={confirming}>
        <div className="screen-header">
          <p className="t-label secondary">{checkedLabel}</p>
          <h1 className="visually-hidden" ref={headingRef} tabIndex={-1}>
            Scan results
          </h1>
          <DryRunBadge dryRun={dryRun} />
        </div>

        {groups.map((group) => (
          <CategorySection
            key={group.category}
            group={group}
            avatars={avatars}
            selection={selection}
            onChange={setSelection}
          />
        ))}

        <div className="action-bar">
          <p className="t-small secondary" aria-live="polite">
            {nothingSelected
              ? "No chats selected. Select at least one to continue."
              : `${plural(selected.length, "chat", "chats")} selected. Everything else stays as it is.`}
          </p>
          <button
            ref={deleteButtonRef}
            className="button button--primary button--block"
            aria-disabled={nothingSelected || undefined}
            onClick={() => !nothingSelected && setConfirming(true)}
          >
            {nothingSelected ? "Delete chats…" : `Delete ${plural(selected.length, "chat", "chats")}…`}
          </button>
          <div className="action-bar-secondary">
            <button className="link-button" onClick={onScanAgain}>
              Scan again
            </button>
            <button className="link-button" onClick={onLogOut}>
              Log out and remove session
            </button>
          </div>
        </div>
      </main>

      {confirming && (
        <ConfirmDialog
          count={selected.length}
          dryRun={dryRun}
          onCancel={closeDialog}
          onConfirm={() => {
            setConfirming(false);
            onDelete(selected);
          }}
        />
      )}
    </>
  );
}

interface SectionProps {
  group: CategoryResult;
  avatars: ReadonlyMap<string, string>;
  selection: Selection;
  onChange: (next: Selection) => void;
}

function CategorySection({ group, avatars, selection, onChange }: SectionProps) {
  const copy = categoryCopy[group.category];
  const ids = useMemo(() => group.chats.map((chat) => chat.id), [group]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const headingId = `category-${group.category}`;
  const selectedHere = countSelected(selection, ids);

  function focusRow(index: number) {
    setActive(index);
    listRef.current?.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[index]?.focus();
  }

  // One Tab stop for the list; arrows move between rows, Space toggles
  // (native checkbox), Cmd/Ctrl+A selects every row in this list.
  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      onChange(selectAll(selection, ids));
      return;
    }
    const next = nextIndex(event.key, active, ids.length);
    if (next !== null) {
      event.preventDefault();
      focusRow(next);
    }
  }

  return (
    <section className="category" aria-labelledby={headingId}>
      <div className="stack-tight">
        <h2 id={headingId} className="t-title">
          {copy.title} · <span className="t-mono">{formatCount(group.chats.length)}</span>
        </h2>
        <p className="t-body secondary">{copy.description}</p>
      </div>

      <div className="list-toolbar">
        <p className="t-label secondary">
          {formatCount(selectedHere)} of {formatCount(ids.length)} selected
        </p>
        <div className="list-toolbar-buttons">
          <button
            className="link-button"
            onClick={() => onChange(selectAll(selection, ids))}
            aria-label={`Select all ${copy.title} chats`}
          >
            Select all
          </button>
          <button
            className="link-button"
            onClick={() => onChange(selectNone(selection, ids))}
            aria-label={`Select none of the ${copy.title} chats`}
          >
            Select none
          </button>
        </div>
      </div>

      <ul ref={listRef} className="chat-list" aria-labelledby={headingId} onKeyDown={onKeyDown}>
        {group.chats.map((chat, index) => {
          const checked = selection.has(chat.id);
          return (
            <li key={chat.id}>
              <label className={checked ? "chat-row chat-row--selectable" : "chat-row chat-row--selectable is-unchecked"}>
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={checked}
                  tabIndex={index === active ? 0 : -1}
                  onFocus={() => setActive(index)}
                  onChange={() => onChange(toggle(selection, chat.id))}
                  aria-label={rowLabel(chat)}
                />
                <Avatar chat={chat} src={avatars.get(chat.id)} />
                <span className={chat.deletedAccount ? "chat-row-name secondary" : "chat-row-name"}>
                  {displayName(chat)}
                </span>
                <span className="t-mono t-small secondary">{formatDate(chat.date)}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
