import { useLocation } from "react-router";
import { useSettingsShell } from "./SettingsShellContext";

/** Where a link of Settings was opened from, so the page's back control can go back instead of on. */
export interface SettingsLocationState {
  settingsFrom: string;
}

/** The path of an address, without its query and part. */
const pathOf = (to: string): string => to.split(/[?#]/, 1)[0] ?? to;

/**
 * What a link to a page deeper in Settings carries: where it was opened from
 * (the location's state, see openedFrom), and the focus once one comes back
 * from its page (useRouteFocus), whatever the page's query or part (`?days=7`,
 * `#access-log`). `returnFocus: false` gives the focus up, for an item that
 * is going away (a device being deleted).
 */
export function useSettingsLink(
  to: string,
  { returnFocus = true }: { returnFocus?: boolean } = {},
): { state: SettingsLocationState; "data-route-focus": "" | undefined } {
  const { pathname } = useLocation();
  const { returnedFrom } = useSettingsShell();
  return {
    state: { settingsFrom: pathname },
    "data-route-focus": returnFocus && returnedFrom === pathOf(to) ? "" : undefined,
  };
}
