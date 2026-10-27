import type { TransportMode } from "@trail/contracts/transport";
import { tripModeLabel } from "../devices/tripModeLabel";
import { capitalise } from "../format/capitalise";
import type { Formatter } from "../format/createFormatter";

/** Below this a phone is effectively standing still (GPS speed jitters around zero). */
const movingSpeedMs = 0.6;

/** A Map: names come from the phone; an object would answer `constructor` from its prototype. */
const motionNames: ReadonlyMap<string, string> = new Map([
  ["driving", "driving"],
  ["automotive", "driving"],
  ["walking", "walking"],
  ["running", "running"],
  ["cycling", "cycling"],
]);

/** Words for the transport modes Trail infers; `unknown` says nothing. */
const modeNames: Readonly<Record<TransportMode, string | null>> = {
  stationary: "not moving",
  walking: "walking",
  running: "running",
  cycling: "cycling",
  car: "by car",
  bus: "by bus",
  tram: "by tram",
  metro: "by metro",
  train: "by train",
  boat: "by boat",
  plane: "flying",
  unknown: null,
};

/** What a description takes of a position: its speed, null when unknown. */
interface Moving {
  speed: number | null;
}

/** What a description can use of what the device is doing; any part may be missing. */
interface Doing {
  readonly motion: readonly string[];
  readonly tripMode: string | null;
  readonly mode: TransportMode | null;
}

/**
 * What someone is doing, in words: "By train · 43 km/h", "Walking",
 * "Standing still" — or null when nothing is known. The inferred transport
 * mode wins when the share includes it (and processing provides one); then a
 * trip running in Overland, then the phone's motion activity. Every part is
 * optional, so the card works with whatever the share includes. A speed is
 * now's only while the position is (`live`, the default): an older position
 * says what they were doing, not how fast.
 */
export function describeActivity(
  location: Moving | null,
  activity: Doing | null,
  format: Formatter,
  { live = true }: { live?: boolean } = {},
): string | null {
  if (location === null) return null;
  const mode =
    activity?.mode === null || activity?.mode === undefined ? null : modeNames[activity.mode];
  const trip =
    activity?.tripMode === null || activity?.tripMode === undefined
      ? null
      : `on a ${tripModeLabel(activity.tripMode)}`;
  const motion = (activity?.motion ?? [])
    .map((value) => motionNames.get(value))
    .filter((value) => value !== undefined);
  const doing = mode ?? trip ?? (motion.length > 0 ? motion.join(", ") : null);
  const moving = location.speed !== null && location.speed >= movingSpeedMs;
  if (doing !== null && doing !== "not moving") {
    return live && location.speed !== null && moving
      ? `${capitalise(doing)} · ${format.speed(location.speed)}`
      : capitalise(doing);
  }
  if (moving && location.speed !== null) {
    // Moving, but how is not known: the speed says it while it is now's.
    if (live) return format.speed(location.speed);
    return doing === "not moving" ? "Standing still" : null;
  }
  if (location.speed !== null || doing === "not moving") return "Standing still";
  return null;
}
