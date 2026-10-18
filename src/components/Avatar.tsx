import type { ChatSummary } from "../lib/api";
import { initials } from "../lib/format";

interface Props {
  chat: ChatSummary;
  /** Downloaded profile photo, when available. */
  src?: string;
  size?: "small" | "large";
}

/** Decorative: the chat's name is always in the row's accessible name. */
export function Avatar({ chat, src, size = "small" }: Props) {
  const className = size === "large" ? "avatar avatar--large" : "avatar";
  if (src) return <img className={className} src={src} alt="" aria-hidden="true" draggable={false} />;
  return (
    <span className={className} aria-hidden="true">
      {initials(chat)}
    </span>
  );
}
