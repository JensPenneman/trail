import { type ReactNode, useCallback, useRef, useState } from "react";
import { AnnouncerContext } from "./AnnouncerContext";

/**
 * One polite live region for the whole app. Messages are for outcomes people
 * would otherwise miss (copied, saved, a device came back); they are cleared
 * first so the same message can be announced twice in a row.
 */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const announce = useCallback((next: string) => {
    clearTimeout(timer.current);
    setMessage("");
    timer.current = setTimeout(() => setMessage(next), 60);
  }, []);
  return (
    <AnnouncerContext value={announce}>
      {children}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {message}
      </div>
    </AnnouncerContext>
  );
}
