import type { DeviceMode } from "@trail/contracts/transport";
import type { Formatter } from "../format/createFormatter";
import { localDateOf } from "../time/localDateOf";
import { describeActivity } from "./describeActivity";

/** The signed-in person now, as the device that reported last has it. */
export interface MeNow {
  /** Its newest position, or null when none of one's devices has reported one. */
  location: { recordedAt: string; speed: number | null; motion: readonly string[] } | null;
  /**
   * Its current mode (`GET /api/v1/devices/{id}/mode`): the quick toggle in
   * force, else the latest stop or move while it is recent; null when there
   * is none, undefined while it loads.
   */
  current: DeviceMode["current"] | undefined;
  /** The mode of a trip running in Overland on it, or null. */
  tripMode: string | null;
}

/** The server's live window and how long a position still says where someone is (§8.5). */
export interface MeThresholds {
  liveMinutes: number;
  staleHours: number;
}

/**
 * What the signed-in person is doing now, in one line: "Cycling · 18 km/h",
 * "At the same place since 08:12", "No recent location". A stop or the quick
 * toggle comes from the current mode, a move's mode too; without one, the trip
 * running in Overland or the phone's motion, as for anyone who shares
 * (`describeActivity`). A position older than the live window of a share
 * without history (`staleHours`) says nothing about now any more. Null when
 * the position holds nothing to tell.
 */
export function describeMe(
  me: MeNow,
  now: number,
  thresholds: MeThresholds,
  format: Formatter,
): string | null {
  const { location, current } = me;
  if (location === null) return "No recent location";
  const age = now - Date.parse(location.recordedAt);
  if (age > thresholds.staleHours * 3_600_000) return "No recent location";
  if (current?.mode === "stationary") {
    const sameDay =
      localDateOf(current.since, format.timeZone) === localDateOf(now, format.timeZone);
    return `At the same place since ${sameDay ? format.time(current.since) : format.dayTime(current.since)}`;
  }
  return describeActivity(
    location,
    { motion: location.motion, tripMode: me.tripMode, mode: current?.mode ?? null },
    format,
    { live: age <= thresholds.liveMinutes * 60_000 },
  );
}
