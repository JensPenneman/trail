import { type PathColour, pathColours } from "@trail/contracts/preferences";
import type { ProcessingLevel } from "@trail/contracts/transport";

/** What the lines of the tracks are coloured by (docs/architecture.md §14), as the controls name them. */
export const pathColourLabels: Readonly<Record<PathColour, string>> = {
  mode: "Mode",
  device: "Device",
  speed: "Speed",
  time: "Time of day",
};

/** The options a level supports: Transport colours by mode too; the others have no modes to show. */
export function pathColoursFor(level: ProcessingLevel): readonly PathColour[] {
  return level === "inferred" ? ["mode", "device", "speed", "time"] : ["device", "speed", "time"];
}

/** What a level is coloured by when nobody chose: Transport by mode, the rest by device. */
export function defaultPathColour(level: ProcessingLevel): PathColour {
  return level === "inferred" ? "mode" : "device";
}

/** A path colouring from the address or the browser's storage, or null for anything else. */
export function parsePathColour(value: string | null): PathColour | null {
  return (pathColours as readonly (string | null)[]).includes(value) ? (value as PathColour) : null;
}

/**
 * `?color=` › the choice remembered on this browser › the account's preference › the level's
 * default. A candidate the level does not support is skipped, never rewritten: Raw with `mode`
 * in the address is coloured by device, and Transport again by mode.
 */
export function resolvePathColour(
  level: ProcessingLevel,
  [fromUrl, remembered, preferred]: readonly [
    string | null,
    PathColour | null,
    PathColour | undefined,
  ],
): PathColour {
  const supported = pathColoursFor(level);
  for (const candidate of [parsePathColour(fromUrl), remembered, preferred ?? null]) {
    if (candidate !== null && supported.includes(candidate)) return candidate;
  }
  return defaultPathColour(level);
}

/** How the lines are coloured now: what by, on which map, in which zone. */
export interface PathColouring {
  by: PathColour;
  /** Whether the map is dark: the classes take their dark steps. */
  dark: boolean;
  /** The account's time zone, for the time of day. */
  timeZone: string;
  /** Every move drawn is on foot: the speed key and bands are paces. */
  onFoot?: boolean;
}
