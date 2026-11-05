import { type PathColour, pathColours } from "@trail/contracts/preferences";
import type { LevelValue, ProcessingLevel } from "@trail/contracts/transport";

/** What the lines of the tracks are coloured by (docs/architecture.md §14), as the controls name them. */
export const pathColourLabels: Readonly<Record<PathColour, string>> = {
  mode: "Mode",
  device: "Device",
  speed: "Speed",
  time: "Time of day",
  altitude: "Altitude",
  accuracy: "Accuracy",
  confidence: "Mode confidence",
};

/** The options a level supports: Transport colours by mode too; the others have no modes to show. */
export function pathColoursFor(level: ProcessingLevel): readonly PathColour[] {
  return level === "inferred"
    ? ["mode", "device", "speed", "time", "altitude", "accuracy", "confidence"]
    : ["device", "speed", "time", "altitude", "accuracy"];
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

/**
 * What a level's tracks have to be asked for (`values=` on `/api/v1/tracks`) to colour by `by`:
 * the server's speed, or the altitude and the accuracy together (one entry in the cache whichever
 * of the two is chosen). The raw level has them all already.
 */
export function levelValuesFor(by: PathColour): readonly LevelValue[] {
  if (by === "speed") return ["speed"];
  return by === "altitude" || by === "accuracy" ? ["altitude", "accuracy"] : [];
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
  /** For the altitude: where its classes begin, in metres, from what is drawn. */
  scale?: readonly number[];
}
