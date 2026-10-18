import { useEffect, useRef, useState } from "react";
import { api, asUiError, type ScanResult, type UiError } from "../lib/api";
import { errorMessage, formatCount, plural } from "../lib/format";
import { useFocusOnMount } from "../lib/useFocusOnMount";

type State = { phase: "scanning"; checked: number; waitUntil: number | null } | { phase: "failed"; error: UiError };

interface Props {
  onDone: (result: ScanResult) => void;
  onLogOut: () => void;
}

const ANNOUNCE_EVERY_MS = 2000;

/** Read-only. Shows a live count; nothing is deleted here. */
export function Scan({ onDone, onLogOut }: Props) {
  const [run, setRun] = useState(0);
  const [state, setState] = useState<State>({ phase: "scanning", checked: 0, waitUntil: null });
  const [announcement, setAnnouncement] = useState("");
  const [now, setNow] = useState(() => Date.now());
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
      .then(onDone)
      .catch((e) => setState({ phase: "failed", error: asUiError(e) }));
  }, [run]);

  // Tick the rate-limit countdown.
  const waiting = state.phase === "scanning" && state.waitUntil !== null;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [waiting]);

  if (state.phase === "failed") {
    const loggedOut = state.error.kind === "notLoggedIn";
    return (
      <main className="screen">
        <div className="screen-header">
          <p className="t-label secondary">Scan stopped · nothing deleted</p>
          <h1 className="t-title" ref={headingRef} tabIndex={-1}>
            The scan didn't finish
          </h1>
          <p className="t-body field-error" role="alert">
            {errorMessage(state.error)}
          </p>
        </div>
        <div className="stack push-bottom">
          {loggedOut ? (
            <button className="button button--primary button--block" onClick={onLogOut}>
              Log in again
            </button>
          ) : (
            <>
              <button className="button button--primary button--block" onClick={() => setRun((r) => r + 1)}>
                Try again
              </button>
              <button className="button button--secondary button--block" onClick={onLogOut}>
                Log out and remove session
              </button>
            </>
          )}
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
        <p className="t-label secondary">Scanning · read-only</p>
        <h1 className="t-title" ref={headingRef} tabIndex={-1}>
          Checking your chats
        </h1>
      </div>
      <p className="count-display" aria-hidden="true">
        {formatCount(state.checked)}
      </p>
      <p className="t-body secondary">
        {state.checked === 1 ? "chat checked" : "chats checked"}. Nothing is deleted at this stage.
      </p>
      {state.waitUntil !== null && (
        <p className="notice t-mono">
          Waiting {Math.max(0, Math.ceil((state.waitUntil - now) / 1000))}s — Telegram's rate limit
        </p>
      )}
    </main>
  );
}
