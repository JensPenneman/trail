import { useOnline } from "../ui/useOnline";

/** The offline banner's explanation, which every control it turns off is described by. */
export const offlineReasonId = "offline-reason";

/**
 * Whether the page is read-only: offline nothing is changed (docs/
 * architecture.md §14). There is no write queue — a toggle "from now" set
 * offline means nothing an hour later, and a correction queued offline would
 * meet a recompute on arrival — so every control that changes something is
 * off, with the reason, until the network returns.
 */
export function useReadOnly(): boolean {
  return !useOnline();
}
