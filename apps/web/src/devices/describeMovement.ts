import type { DeviceSummary } from "@trail/contracts/device";
import type { Formatter } from "../format/createFormatter";

/** Below this the phone is effectively standing still (GPS speed jitters around zero). */
const movingSpeedMs = 0.6;

const motionNames: Readonly<Record<string, string>> = {
  driving: "driving",
  automotive: "driving",
  walking: "walking",
  running: "running",
  cycling: "cycling",
  stationary: "stationary",
};

/** "32 km/h · driving", "Standing still" or null when nothing is known. */
export function describeMovement(
  location: DeviceSummary["lastLocation"],
  format: Formatter,
): string | null {
  if (location === null) return null;
  const motion = location.motion
    .map((value) => motionNames[value] ?? value.replaceAll("_", " "))
    .filter((value) => value !== "stationary" && value !== "unknown");
  const speed = location.speed;
  if (speed !== null && speed >= movingSpeedMs) {
    return motion.length > 0
      ? `${format.speed(speed)} · ${motion.join(", ")}`
      : format.speed(speed);
  }
  if (motion.length > 0) return motion.join(", ");
  return speed === null && location.motion.length === 0 ? null : "Standing still";
}
