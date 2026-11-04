import type { ShellAddress } from "../../settings/SettingsShellContext";

export const insightsRootPath = "/insights";

/**
 * How deep an Insights screen lies: the summary is the root, the screens of
 * a mode, of When you travel and of Roads are one level down. Going to a lower
 * level is going back (the slide from the left, the focus on the row left).
 */
export function levelOf(pathname: string): number {
  return pathname.replace(/\/+$/, "") === insightsRootPath ? 0 : 1;
}

/** What tells one screen from another: its path (the period and devices are the same screen's). */
export function keyOf({ pathname }: ShellAddress): string {
  return pathname.replace(/\/+$/, "") || "/";
}
