import { useEffect, useRef } from "react";

/**
 * Moves focus to an element (usually the screen heading) when it mounts or
 * when `key` changes, so keyboard and screen-reader users land on the new step.
 */
export function useFocusOnMount<T extends HTMLElement>(key?: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [key]);
  return ref;
}
