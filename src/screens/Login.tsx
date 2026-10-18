import { useId, useRef, useState, type FormEvent } from "react";
import { api, asUiError, type UiError } from "../lib/api";
import { errorMessage } from "../lib/format";
import { useFocusOnMount } from "../lib/useFocusOnMount";

type Step = { name: "phone" } | { name: "code" } | { name: "password"; hint: string | null };

interface Props {
  onDone: () => void;
  onCancel: () => void;
}

export function Login({ onDone, onCancel }: Props) {
  const [step, setStep] = useState<Step>({ name: "phone" });
  const [value, setValue] = useState("");
  const [error, setError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  // Each step lands on its field; the label and hint are read with it.
  const inputRef = useFocusOnMount<HTMLInputElement>(step.name);
  const submitting = useRef(false);
  const inputId = useId();
  const messageId = useId();

  const goTo = (next: Step) => {
    setStep(next);
    setValue("");
    setError(null);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !value.trim()) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      if (step.name === "phone") {
        await api.requestCode(value);
        goTo({ name: "code" });
      } else if (step.name === "code") {
        const result = await api.submitCode(value);
        if (result.step === "done") onDone();
        else goTo({ name: "password", hint: result.hint });
      } else {
        await api.submitPassword(value);
        onDone();
      }
    } catch (e) {
      setError(asUiError(e));
      // Select the rejected value so typing replaces it.
      inputRef.current?.focus();
      inputRef.current?.select();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const copy = {
    phone: {
      title: "Your phone number",
      label: "Phone number",
      hint: "Include the country code, for example +62 812 3456 7890.",
      button: "Send code",
      busy: "Sending code…",
    },
    code: {
      title: "Enter the login code",
      label: "Login code",
      hint: "Telegram sends it to the Telegram app on your phone or computer.",
      button: "Continue",
      busy: "Checking…",
    },
    password: {
      title: "Enter your password",
      label: "Two-step verification password",
      hint:
        step.name === "password" && step.hint
          ? `Your account has an extra password. Hint: ${step.hint}`
          : "Your account has an extra password.",
      button: "Log in",
      busy: "Logging in…",
    },
  }[step.name];

  return (
    <main className="screen">
      <div className="screen-header">
        <p className="t-label secondary">Log in</p>
        <h1 className="t-title">
          {copy.title}
        </h1>
      </div>

      <form className="stack" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor={inputId} className="t-heading">
            {copy.label}
          </label>
          <input
            id={inputId}
            key={step.name}
            ref={inputRef}
            className="field-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={messageId}
            readOnly={busy}
            aria-busy={busy || undefined}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            {...(step.name === "phone"
              ? { type: "tel", autoComplete: "tel", placeholder: "+62 812 3456 7890" }
              : step.name === "code"
                ? { type: "text", inputMode: "numeric", autoComplete: "one-time-code" }
                : { type: "password", autoComplete: "current-password" })}
          />
          <p id={messageId} className={error ? "t-small field-error" : "t-small field-hint"} role={error ? "alert" : undefined}>
            {error
              ? errorMessage(error) +
                (error.kind === "invalidPassword" && step.name === "password" && step.hint ? ` Hint: ${step.hint}` : "")
              : copy.hint}
          </p>
        </div>

        <button type="submit" className="button button--primary button--block" aria-disabled={busy || !value.trim() || undefined}>
          {busy ? copy.busy : copy.button}
        </button>

        {step.name === "phone" ? (
          <button type="button" className="link-button" onClick={onCancel} disabled={busy}>
            Back
          </button>
        ) : (
          <button type="button" className="link-button" onClick={() => goTo({ name: "phone" })} disabled={busy}>
            Use a different number
          </button>
        )}
      </form>

      <p className="t-small secondary push-bottom">
        Sift keeps your login in this computer's secure storage. Your password is never saved.
      </p>
    </main>
  );
}
