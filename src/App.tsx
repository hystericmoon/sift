import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { Intro } from "./screens/Intro";
import { Login } from "./screens/Login";
import { Scan } from "./screens/Scan";

type Screen = "starting" | "intro" | "login" | "scan";

export function App() {
  const [screen, setScreen] = useState<Screen>("starting");

  // A saved session goes straight to the scan; anything else starts at the intro.
  useEffect(() => {
    api
      .restoreSession()
      .then((restored) => setScreen(restored ? "scan" : "intro"))
      .catch(() => setScreen("intro"));
  }, []);

  switch (screen) {
    case "starting":
      return <main className="screen screen--center" aria-busy="true" />;
    case "intro":
      return <Intro onStart={() => setScreen("login")} />;
    case "login":
      return <Login onDone={() => setScreen("scan")} onCancel={() => setScreen("intro")} />;
    case "scan":
      return <Scan onLoggedOut={() => setScreen("intro")} />;
  }
}
