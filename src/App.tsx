import { useCallback, useEffect, useState } from "react";
import { api, type ChatSummary, type DeleteReport, type ScanResult } from "./lib/api";
import { Deleting } from "./screens/Deleting";
import { Intro } from "./screens/Intro";
import { Login } from "./screens/Login";
import { Results } from "./screens/Results";
import { Scan } from "./screens/Scan";
import { Summary } from "./screens/Summary";

type Screen =
  | { name: "starting" }
  | { name: "intro" }
  | { name: "login" }
  | { name: "scan"; run: number }
  | { name: "results"; result: ScanResult }
  | { name: "deleting"; chats: ChatSummary[] }
  | { name: "summary"; report: DeleteReport; chats: ChatSummary[] }
  | { name: "loggingOut" };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "starting" });
  const [dryRun, setDryRun] = useState(true);
  const [avatars, setAvatars] = useState<ReadonlyMap<string, string>>(new Map());

  // A saved session goes straight to the scan; anything else starts at the intro.
  useEffect(() => {
    api
      .appInfo()
      .then((info) => setDryRun(info.dryRun))
      .catch(() => setDryRun(true));
    api
      .restoreSession()
      .then((restored) => setScreen(restored ? { name: "scan", run: 0 } : { name: "intro" }))
      .catch(() => setScreen({ name: "intro" }));
  }, []);

  const scanAgain = useCallback(() => {
    setAvatars(new Map());
    setScreen((s) => ({ name: "scan", run: s.name === "scan" ? s.run + 1 : Date.now() }));
  }, []);

  const logOut = useCallback(() => {
    setScreen({ name: "loggingOut" });
    setAvatars(new Map());
    api
      .logOut()
      .catch(() => undefined)
      .finally(() => setScreen({ name: "intro" }));
  }, []);

  const showResults = useCallback((result: ScanResult) => {
    setScreen({ name: "results", result });
    if (result.categories.some((group) => group.chats.some((chat) => chat.hasPhoto))) {
      // Best effort: photos fill in as they arrive; initials stay otherwise.
      api
        .loadAvatars((event) => setAvatars((prev) => new Map(prev).set(event.id, event.dataUrl)))
        .catch(() => undefined);
    }
  }, []);

  switch (screen.name) {
    case "starting":
      return <main className="screen screen--center" aria-busy="true" />;
    case "loggingOut":
      return (
        <main className="screen screen--center" aria-busy="true">
          <p className="t-body secondary" role="status">
            Logging out and removing the session from this computer…
          </p>
        </main>
      );
    case "intro":
      return <Intro onStart={() => setScreen({ name: "login" })} />;
    case "login":
      return (
        <Login
          onDone={() => setScreen({ name: "scan", run: Date.now() })}
          onCancel={() => setScreen({ name: "intro" })}
        />
      );
    case "scan":
      return <Scan key={screen.run} onDone={showResults} onLogOut={logOut} />;
    case "results":
      return (
        <Results
          result={screen.result}
          avatars={avatars}
          dryRun={dryRun}
          onDelete={(chats) => setScreen({ name: "deleting", chats })}
          onScanAgain={scanAgain}
          onLogOut={logOut}
        />
      );
    case "deleting":
      return (
        <Deleting
          chats={screen.chats}
          avatars={avatars}
          dryRun={dryRun}
          onDone={(report) => setScreen({ name: "summary", report, chats: screen.chats })}
        />
      );
    case "summary":
      return (
        <Summary
          report={screen.report}
          chats={screen.chats}
          avatars={avatars}
          onScanAgain={scanAgain}
          onLogOut={logOut}
        />
      );
  }
}
