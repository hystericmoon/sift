import { useEffect, useRef, useState } from "react";
import { api, asUiError, type ScanResult, type UiError } from "../lib/api";
import { displayName, errorMessage, formatDate, formatDateLong, initials, plural } from "../lib/format";
import { useFocusOnMount } from "../lib/useFocusOnMount";

type State =
  | { phase: "scanning"; checked: number; waitUntil: number | null }
  | { phase: "done"; result: ScanResult }
  | { phase: "failed"; error: UiError };

interface Props {
  onLoggedOut: () => void;
}

const ANNOUNCE_EVERY_MS = 2000;

export function Scan({ onLoggedOut }: Props) {
  const [run, setRun] = useState(0);
  const [state, setState] = useState<State>({ phase: "scanning", checked: 0, waitUntil: null });
  const [announcement, setAnnouncement] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [loggingOut, setLoggingOut] = useState(false);
  const startedRun = useRef<number | null>(null);
  const lastAnnounced = useRef(0);
  const headingRef = useFocusOnMount<HTMLHeadingElement>(state.phase);

  // Start one scan per run. The ref keeps React's dev double-effect from starting two.
  useEffect(() => {
    if (startedRun.current === run) return;
    startedRun.current = run;
    lastAnnounced.current = 0;
    setState({ phase: "scanning", checked: 0, waitUntil: null });
    setAnnouncement("Scanning your chats. Nothing is deleted.");

    api
      .scan((event) => {
        if (event.event === "progress") {
          setState({ phase: "scanning", checked: event.checked, waitUntil: null });
          if (Date.now() - lastAnnounced.current > ANNOUNCE_EVERY_MS) {
            lastAnnounced.current = Date.now();
            setAnnouncement(`${plural(event.checked, "chat", "chats")} checked`);
          }
        } else {
          const waitUntil = Date.now() + event.seconds * 1000;
          setNow(Date.now());
          setState((s) => (s.phase === "scanning" ? { ...s, waitUntil } : s));
          setAnnouncement(`Waiting ${event.seconds} seconds for Telegram's rate limit. The scan continues on its own.`);
        }
      })
      .then((result) => {
        setState({ phase: "done", result });
        setAnnouncement(
          `Scan complete. ${plural(result.checked, "chat", "chats")} checked. ` +
            (result.joinOnly.length ? `${result.joinOnly.length} hold only a join notice.` : "Nothing to clear."),
        );
      })
      .catch((e) => setState({ phase: "failed", error: asUiError(e) }));
  }, [run]);

  // Tick the rate-limit countdown.
  const waiting = state.phase === "scanning" && state.waitUntil !== null;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [waiting]);

  async function logOut() {
    setLoggingOut(true);
    try {
      await api.logOut();
    } finally {
      onLoggedOut();
    }
  }

  const actions = (
    <div className="stack push-bottom">
      <button className="button button--secondary button--block" onClick={() => setRun((r) => r + 1)} disabled={loggingOut}>
        Scan again
      </button>
      <button className="button button--secondary button--block" onClick={logOut} disabled={loggingOut}>
        {loggingOut ? "Logging out…" : "Log out and remove session"}
      </button>
    </div>
  );

  return (
    <main className="screen">
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {state.phase === "scanning" && (
        <>
          <div className="screen-header">
            <p className="t-label secondary">Scanning · read-only</p>
            <h1 className="t-title" ref={headingRef} tabIndex={-1}>
              Checking your chats
            </h1>
          </div>
          <p className="count-display" aria-hidden="true">
            {state.checked.toLocaleString("en-GB")}
          </p>
          <p className="t-body secondary">
            {state.checked === 1 ? "chat checked" : "chats checked"}. Nothing is deleted at this stage.
          </p>
          {state.waitUntil !== null && (
            <p className="notice t-mono">
              Waiting {Math.max(0, Math.ceil((state.waitUntil - now) / 1000))}s — Telegram's rate limit
            </p>
          )}
        </>
      )}

      {state.phase === "done" && (
        <>
          <div className="screen-header">
            <p className="t-label secondary">
              {plural(state.result.checked, "chat", "chats")} checked · nothing deleted
            </p>
            <h1 className="t-title" ref={headingRef} tabIndex={-1}>
              {state.result.joinOnly.length
                ? `Joined Telegram only · ${state.result.joinOnly.length}`
                : "Nothing to clear."}
            </h1>
            {state.result.joinOnly.length === 0 && (
              <p className="t-body secondary">Your chat list is already clean.</p>
            )}
          </div>

          {state.result.joinOnly.length > 0 && (
            <ul className="chat-list" aria-label="Chats that hold only a join notice">
              {state.result.joinOnly.map((chat) => (
                <li
                  key={chat.id}
                  className="chat-row"
                  aria-label={`${displayName(chat)}, joined ${formatDateLong(chat.date)}`}
                >
                  <span className="avatar" aria-hidden="true">
                    {initials(chat)}
                  </span>
                  <span className={chat.deletedAccount ? "chat-row-name secondary" : "chat-row-name"}>
                    {displayName(chat)}
                  </span>
                  <span className="t-mono t-small secondary">{formatDate(chat.date)}</span>
                </li>
              ))}
            </ul>
          )}
          {actions}
        </>
      )}

      {state.phase === "failed" && (
        <>
          <div className="screen-header">
            <p className="t-label secondary">Scan stopped · nothing deleted</p>
            <h1 className="t-title" ref={headingRef} tabIndex={-1}>
              The scan didn't finish
            </h1>
            <p className="t-body field-error" role="alert">
              {errorMessage(state.error)}
            </p>
          </div>
          {actions}
        </>
      )}
    </main>
  );
}
