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
  // A place is a level below Places, and its days one more.
  if (parts[1] === "place") return parts[2] === "days" ? 3 : 2;
  return parts[1] === "transport" && parts.length >= 4 ? 2 : 1;
}

/**
 * What tells one screen from another: its path (the period and devices are
 * the same screen's), and for the screens of a place the place, so that the
 * row of the place one comes back from is told from the others.
 */
export function keyOf({ pathname, search }: ShellAddress): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path !== "/insights/place" && path !== "/insights/place/days") return path;
  const place = new URLSearchParams(search).get("place");
  return place === null ? path : `${path}?place=${place}`;
}

/** The parts of a mode, each a screen two levels down. */
export type ModePart = "time" | "roads" | "speed" | "moves";

export const modePath = (mode: string, part?: ModePart): string =>
  `${insightsRootPath}/transport/${mode}${part === undefined ? "" : `/${part}`}`;
