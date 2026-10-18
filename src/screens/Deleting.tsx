import { useEffect, useRef, useState } from "react";
import { api, asUiError, type ChatSummary, type DeleteReport, type UiError } from "../lib/api";
import { displayName, errorMessage, formatCount } from "../lib/format";
import { useFocusOnMount } from "../lib/useFocusOnMount";
import { Avatar } from "../components/Avatar";
import { DryRunBadge } from "../components/DryRunBadge";

interface Props {
  chats: ChatSummary[];
  avatars: ReadonlyMap<string, string>;
  dryRun: boolean;
  onDone: (report: DeleteReport) => void;
}

const ANNOUNCE_EVERY_MS = 3000;

export function Deleting({ chats, avatars, dryRun, onDone }: Props) {
  const total = chats.length;
  const [done, setDone] = useState(0);
  const [current, setCurrent] = useState<ChatSummary | null>(null);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const started = useRef(false);
  const lastAnnounced = useRef(0);
  const headingRef = useFocusOnMount<HTMLHeadingElement>();

  useEffect(() => {
    // Guard against React's dev double-effect: a delete must start once.
    if (started.current) return;
    started.current = true;
    const byId = new Map(chats.map((chat) => [chat.id, chat]));
    setAnnouncement(`${dryRun ? "Dry run started" : "Deleting started"}. 0 of ${total} done.`);

    api
      .deleteChats(
        chats.map((chat) => chat.id),
        (event) => {
          if (event.event === "started") {
            setCurrent(byId.get(event.id) ?? null);
            setWaitUntil(null);
          } else if (event.event === "finished") {
            setDone(event.index);
            setWaitUntil(null);
            if (Date.now() - lastAnnounced.current > ANNOUNCE_EVERY_MS) {
              lastAnnounced.current = Date.now();
              setAnnouncement(`${event.index} of ${event.total} done.`);
            }
          } else {
            setNow(Date.now());
            setWaitUntil(Date.now() + event.seconds * 1000);
            setAnnouncement(`Waiting ${event.seconds} seconds for Telegram's rate limit. Deleting continues on its own.`);
          }
        },
      )
      .then(onDone)
      .catch((e) => setError(asUiError(e)));
  }, []);

  // Tick the rate-limit countdown.
  useEffect(() => {
    if (waitUntil === null) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [waitUntil]);

  function stop() {
    setStopping(true);
    setAnnouncement("Stopping after the current chat.");
    void api.stopDeleting();
  }

  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const secondsLeft = waitUntil === null ? 0 : Math.max(0, Math.ceil((waitUntil - now) / 1000));

  if (error) {
    return (
      <main className="screen">
        <div className="screen-header">
          <p className="t-label secondary">Stopped · {formatCount(done)} of {formatCount(total)} done</p>
          <h1 className="t-title" ref={headingRef} tabIndex={-1}>
            Deleting didn't finish
          </h1>
          <p className="t-body field-error" role="alert">
            {errorMessage(error)}
          </p>
          <p className="t-body secondary">Chats that weren't reached are untouched. Scan again to see what's left.</p>
        </div>
        <div className="stack push-bottom">
          <button
            className="button button--primary button--block"
            onClick={() =>
              onDone({
                dryRun,
                total,
                deleted: 0,
                notDeleted: [],
                stopped: true,
                connectionLost: error.kind === "network",
              })
            }
          >
            Continue
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="screen">
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <div className="screen-header">
        <p className="t-label secondary">{dryRun ? "Simulating · read-only" : "Deleting · for you only"}</p>
        <h1 className="t-title" ref={headingRef} tabIndex={-1}>
          {dryRun ? "Checking chats (dry run)" : "Deleting chats"}
        </h1>
        <DryRunBadge dryRun={dryRun} />
      </div>

      <p className="count-display" aria-hidden="true">
        {done}/{total}
      </p>
      <div
        className="progress"
        role="progressbar"
        aria-label="Chats done"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={`${done} of ${total} done`}
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>

      {current && waitUntil === null && (
        <div className="current-chat">
          <Avatar chat={current} src={avatars.get(current.id)} />
          <p className="t-body">
            <span className="secondary">{dryRun ? "Checking " : "Checking again, then removing "}</span>
            {displayName(current)}
          </p>
        </div>
      )}
      {waitUntil !== null && <p className="notice t-mono">Waiting {secondsLeft}s — Telegram's rate limit</p>}

      <p className="t-small secondary">
        {dryRun
          ? "Each chat is checked again exactly as in a real run, at about one per second. Nothing is removed."
          : "Each chat is checked again right before it's removed. If someone wrote since the scan, the chat is skipped. About one chat per second."}
      </p>

      <div className="stack push-bottom">
        <button className="button button--secondary button--block" onClick={stop} aria-disabled={stopping || undefined}>
          {stopping ? "Stopping after this chat…" : "Stop after this chat"}
        </button>
      </div>
    </main>
  );
}
