interface Props {
  onStart: () => void;
}

export function Intro({ onStart }: Props) {
  return (
    <main className="screen screen--center">
      <div className="screen-header">
        <h1 className="wordmark">Sift</h1>
        <p className="t-title">Clear out chats that hold only a join notice.</p>
        <p className="t-body secondary">
          Sift finds chats where the only message is “joined Telegram” and lists them for you to review. Chats with
          real messages stay untouched, and so do your contacts.
        </p>
      </div>

      <div className="stack">
        <button className="button button--primary button--block" onClick={onStart} autoFocus>
          Log in to start
        </button>
        <p className="t-small secondary">Everything runs on this computer. No servers, no tracking.</p>
        <p className="t-small secondary">Sift uses the Telegram API and is not affiliated with Telegram.</p>
      </div>
    </main>
  );
}
