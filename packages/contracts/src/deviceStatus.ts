/**
 * Freshness of a device, from its last accepted upload:
 * - `live`  — uploaded within `liveMinutes`
 * - `idle`  — uploaded within `staleHours` (normal while standing still: Overland pauses)
 * - `stale` — silent for longer: the phone probably stopped tracking
 * - `never` — no upload yet
 */
export type DeviceStatus = "live" | "idle" | "stale" | "never";

export function deviceStatus(
  lastSeenAt: string | null,
  now: Date,
  thresholds: { liveMinutes: number; staleHours: number },
): DeviceStatus {
  if (lastSeenAt === null) return "never";
  const ageMs = now.getTime() - Date.parse(lastSeenAt);
  if (ageMs <= thresholds.liveMinutes * 60_000) return "live";
  if (ageMs <= thresholds.staleHours * 3_600_000) return "idle";
  return "stale";
}
