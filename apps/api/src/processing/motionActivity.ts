/** CoreMotion's activities as Overland reports them ("driving" is CMMotionActivity.automotive). */
export type MotionActivity = "stationary" | "walking" | "running" | "cycling" | "automotive";

const activities: Readonly<Record<string, MotionActivity>> = {
  stationary: "stationary",
  walking: "walking",
  running: "running",
  cycling: "cycling",
  driving: "automotive",
  automotive: "automotive",
};

/**
 * The activity of one reading: a moving activity wins over `stationary` (iOS
 * reports a car at a red light as both), null when there is none.
 */
export function motionActivity(motion: readonly string[]): MotionActivity | null {
  let still = false;
  let moving: MotionActivity | null = null;
  for (const value of motion) {
    const activity = activities[value];
    if (activity === "stationary") still = true;
    else if (activity !== undefined && moving === null) moving = activity;
  }
  return moving ?? (still ? "stationary" : null);
}
