import { useContext, useMemo } from "react";
import { SessionUserContext } from "../app/SessionUserContext";
import { createFormatter, type Formatter } from "./createFormatter";
import { resolveFormatLocale } from "./resolveFormatLocale";

/**
 * Formatting in the signed-in person's time zone (their account setting, not
 * the device's), or the browser's zone on public pages.
 */
export function useFormatter(): Formatter {
  const user = useContext(SessionUserContext);
  const timeZone = user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return useMemo(
    () => createFormatter(resolveFormatLocale(navigator.languages), timeZone),
    [timeZone],
  );
}
