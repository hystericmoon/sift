import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { formatCount } from "../lib/format";

interface Props {
  count: number;
  dryRun: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Modal confirmation. Focus starts on Cancel (the safe choice), Tab stays
 * inside, Esc cancels. The caller makes the page behind it inert and returns
 * focus to the button that opened it.
 */
export function ConfirmDialog({ count, dryRun, onCancel, onConfirm }: Props) {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const chats = count === 1 ? "chat" : "chats";
  const body =
    count === 1
      ? "It holds only a join notice. It's removed for you only, and your contacts stay. This can't be undone."
      : "Each one holds only a join notice. They're removed for you only, and your contacts stay. This can't be undone.";

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        ref={dialogRef}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="t-title">
          Delete {formatCount(count)} {chats}?
        </h2>
        <div id={bodyId} className="stack">
          <p className="t-body secondary">{body}</p>
          {dryRun && (
            <p className="t-small secondary">Dry run: Sift will check each chat and report, but nothing is deleted.</p>
          )}
        </div>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="button button--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button button--danger" onClick={onConfirm}>
            Delete {formatCount(count)} {chats}
          </button>
        </div>
      </div>
    </div>
  );
}
