import { useLocation } from "react-router";
import { useSettingsShell } from "./SettingsShellContext";

/** Where a link of a shell was opened from, so the screen's back control can go back instead of on. */
export interface SettingsLocationState {
  settingsFrom: string;
}

/** An address split into its path and query (the part after `#` is no screen of its own). */
export function addressOf(to: string): { pathname: string; search: string } {
  const [beforeHash = to] = to.split("#", 1);
  const at = beforeHash.indexOf("?");
  return at < 0
    ? { pathname: beforeHash, search: "" }
    : { pathname: beforeHash.slice(0, at), search: beforeHash.slice(at) };
}

/**
 * What a link to a screen deeper in a shell carries: where it was opened from
 * (the location's state, see openedFrom), and the focus once one comes back
 * from its screen (useRouteFocus), whatever the screen's other query or part
 * (`?days=7`, `#access-log`). `returnFocus: false` gives the focus up, for an
 * item that is going away (a device being deleted).
 */
export function useSettingsLink(
  to: string,
  { returnFocus = true }: { returnFocus?: boolean } = {},
): { state: SettingsLocationState; "data-route-focus": "" | undefined } {
  const { pathname } = useLocation();
  const { returnedFrom, keyOf } = useSettingsShell();
  return {
    state: { settingsFrom: pathname },
    "data-route-focus": returnFocus && returnedFrom === keyOf(addressOf(to)) ? "" : undefined,
  };
}
