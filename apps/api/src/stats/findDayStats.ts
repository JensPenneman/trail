import type { DayStat } from "@trail/contracts/stats";
import { loadStampedDays } from "../cache/dayStamps";
import type { Database } from "../db/database";
import type { DeviceAccess } from "../devices/deviceAccess";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";
import { addDays } from "../lib/calendarDate";

/**
 * Per-day totals of local calendar days `from`..`to` (both included, the
 * owner's time zone) for the devices the principal reaches, each with its
 * stamp — the dashboard's `/api/stats/days` and v1's `/api/v1/stats/days`.
 * Days without points have no row. Totals and stamps come from one statement,
 * so they describe the same instant (docs/architecture.md §8.9).
 */
export async function findDayStats(
  db: Database,
  access: DeviceAccess & { user: { timezone: string } },
  query: { from: string; to: string; deviceIds?: readonly string[] | undefined },
): Promise<DayStat[]> {
  const ids = (await resolveDeviceIds(db, access, query.deviceIds)).map((device) => device.id);
  const dates: string[] = [];
  for (let date = query.from; date <= query.to; date = addDays(date, 1)) dates.push(date);
  const days = await loadStampedDays(db, {
    deviceIds: ids,
    timezone: access.user.timezone,
    dates,
  });
  return days.flatMap((day) => (day.stat === null ? [] : [{ ...day.stat, stamp: day.stamp }]));
}
