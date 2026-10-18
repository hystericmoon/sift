import { useState } from "react";
import type { ChatOutcome, ChatSummary, DeleteReport } from "../lib/api";
import { displayName, formatCount, outcomeText, plural } from "../lib/format";
import { useFocusOnMount } from "../lib/useFocusOnMount";
import { Avatar } from "../components/Avatar";
import { DryRunBadge } from "../components/DryRunBadge";

interface Props {
  report: DeleteReport;
  chats: ChatSummary[];
  avatars: ReadonlyMap<string, string>;
  onScanAgain: () => void;
  onLogOut: () => void;
}

/** How many rows of each list show before "Show all". */
const SHORT_LIST = 8;

export function Summary({ report, chats, avatars, onScanAgain, onLogOut }: Props) {
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  const skipped = report.notDeleted.filter((c) => c.outcome.result === "skipped");
  const failed = report.notDeleted.filter((c) => c.outcome.result === "failed");
  const untouched = Math.max(0, report.total - report.deleted - report.notDeleted.length);
  const deletedWord = report.dryRun ? "Would delete" : "Deleted";

  const title = report.dryRun
    ? "Dry run complete"
    : report.deleted === 0
      ? "No chats deleted"
      : `Deleted ${plural(report.deleted, "chat", "chats")}`;

  return (
    <main className="screen">
      <div className="screen-header">
        <p className="t-label secondary">
          Summary · {formatCount(report.total)} selected
        </p>
        <h1 className="t-title" ref={headingRef} tabIndex={-1}>
          {title}
        </h1>
        <DryRunBadge dryRun={report.dryRun} />
        <p className="t-body secondary">
          {report.dryRun
            ? `${plural(report.deleted, "chat", "chats")} would have been deleted. Nothing was changed.`
            : "Removed for you only. Your contacts and every chat with real messages are untouched."}
        </p>
        {report.stopped && untouched > 0 && (
          <p className="t-body secondary">
            You stopped early. The other {plural(untouched, "chat was", "chats were")} not touched.
          </p>
        )}
        {report.connectionLost && (
          <p className="t-body field-error" role="alert">
            Sift lost its connection to Telegram and stopped.
            {untouched > 0 && ` The other ${plural(untouched, "chat was", "chats were")} not touched.`}
          </p>
        )}
      </div>

      <dl className="stats">
        <div className="stat">
          <dt className="t-label secondary">{deletedWord}</dt>
          <dd className="stat-value">{formatCount(report.deleted)}</dd>
        </div>
        <div className="stat">
          <dt className="t-label secondary">Skipped</dt>
          <dd className="stat-value">{formatCount(skipped.length)}</dd>
        </div>
        <div className="stat">
          <dt className="t-label secondary">Failed</dt>
          <dd className={failed.length ? "stat-value stat-value--danger" : "stat-value"}>{formatCount(failed.length)}</dd>
        </div>
      </dl>

      <OutcomeList title="Failed" items={failed} chats={chats} avatars={avatars} />
      <OutcomeList title="Skipped" items={skipped} chats={chats} avatars={avatars} />

      <div className="stack push-bottom">
        <button className="button button--primary button--block" onClick={onScanAgain}>
          Scan again
        </button>
        <button className="button button--secondary button--block" onClick={onLogOut}>
          Log out and remove session
        </button>
        <p className="t-small secondary">
          Logging out ends Sift's session with Telegram and removes it from this computer.
        </p>
      </div>
    </main>
  );
}

interface ListProps {
  title: string;
  items: ChatOutcome[];
  chats: ChatSummary[];
  avatars: ReadonlyMap<string, string>;
}

function OutcomeList({ title, items, chats, avatars }: ListProps) {
  const [showAll, setShowAll] = useState(false);
  if (items.length === 0) return null;
  const byId = new Map(chats.map((chat) => [chat.id, chat]));
  const shown = showAll ? items : items.slice(0, SHORT_LIST);
  const headingId = `outcomes-${title.toLowerCase()}`;

  return (
    <section className="stack-tight" aria-labelledby={headingId}>
      <h2 id={headingId} className="t-label secondary">
        {title} · {formatCount(items.length)}
      </h2>
      <ul className="chat-list">
        {shown.map((item) => {
          const chat = byId.get(item.id) ?? { id: item.id, name: "", deletedAccount: true, hasPhoto: false, date: 0 };
          return (
            <li key={item.id} className="chat-row chat-row--outcome">
              <Avatar chat={chat} src={avatars.get(chat.id)} />
              <div className="chat-row-text">
                <span className="chat-row-name">{displayName(chat)}</span>
                <span className="t-small secondary">{outcomeText(item.outcome)}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {items.length > SHORT_LIST && !showAll && (
        <button className="link-button" onClick={() => setShowAll(true)}>
          Show all {formatCount(items.length)}
        </button>
      )}
    </section>
  );
}
