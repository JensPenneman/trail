import type { ShellAddress } from "../../settings/SettingsShellContext";

export const insightsRootPath = "/insights";

/**
 * How deep an Insights screen lies: the summary is the root; a mode's screen,
 * When you travel and Roads are one level down; the parts of a mode (its
 * When, Roads, Speed and Longest moves) two. Going to a lower level is going
 * back (the slide from the left, the focus on the row left).
 */
export function levelOf(pathname: string): number {
  const parts = pathname.split("/").filter((part) => part !== "");
  if (parts.length <= 1) return 0;
  return parts[1] === "transport" && parts.length >= 4 ? 2 : 1;
}

/** What tells one screen from another: its path (the period and devices are the same screen's). */
export function keyOf({ pathname }: ShellAddress): string {
  return pathname.replace(/\/+$/, "") || "/";
}

/** The parts of a mode, each a screen two levels down. */
export type ModePart = "time" | "roads" | "speed" | "moves";

export const modePath = (mode: string, part?: ModePart): string =>
  `${insightsRootPath}/transport/${mode}${part === undefined ? "" : `/${part}`}`;
