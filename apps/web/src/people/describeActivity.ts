import type { PersonActivity, PersonLocation } from "@trail/contracts/person";
import type { TransportMode } from "@trail/contracts/transport";
import { tripModeLabel } from "../devices/tripModeLabel";
import type { Formatter } from "../format/createFormatter";

/** Below this a phone is effectively standing still (GPS speed jitters around zero). */
const movingSpeedMs = 0.6;

const motionNames: Readonly<Record<string, string>> = {
  driving: "driving",
  automotive: "driving",
  walking: "walking",
  running: "running",
  cycling: "cycling",
};

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

/**
 * What someone is doing, in words: "32 km/h · by train", "Walking",
 * "Standing still" — or null when nothing is known. The inferred transport
 * mode wins when the share includes it (and processing provides one); then a
 * trip running in Overland, then the phone's motion activity. Every part is
 * optional, so the card works with whatever the share includes.
 */
export function describeActivity(
  location: PersonLocation | null,
  activity: PersonActivity | null,
  format: Formatter,
): string | null {
  if (location === null) return null;
  const mode =
    activity?.mode === null || activity?.mode === undefined ? null : modeNames[activity.mode];
  const trip =
    activity?.tripMode === null || activity?.tripMode === undefined
      ? null
      : `on a ${tripModeLabel(activity.tripMode)}`;
  const motion = (activity?.motion ?? [])
    .map((value) => motionNames[value])
    .filter((value) => value !== undefined);
  const doing = mode ?? trip ?? (motion.length > 0 ? motion.join(", ") : null);
  const speed = location.speed;
  if (speed !== null && speed >= movingSpeedMs) {
    return doing === null ? format.speed(speed) : `${format.speed(speed)} · ${doing}`;
  }
  if (doing !== null && doing !== "not moving") return capitalise(doing);
  if (speed !== null || doing === "not moving") return "Standing still";
  return null;
}

const capitalise = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
