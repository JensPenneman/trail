import type { InsightsPeriod } from "@trail/contracts/insights";
import type { Executor } from "../db/database";
import type { DeviceAccess } from "../devices/deviceAccess";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";
import { localDate } from "../lib/localDate";
import { firstSegmentAt } from "./insightMoves";
import { resolvePeriod } from "./insightsPeriod";
import { type LocalHour, localHours } from "./localHours";

/** What every Insights request works on: whose devices, which local days and their hours. */
export interface InsightsScope {
  timezone: string;
  deviceIds: string[];
  period: InsightsPeriod;
  hours: LocalHour[];
  /** The period as instants: from its first hour's start to its last hour's end. */
  start: Date;
  end: Date;
}

/**
 * The devices (the principal's own, a token's only those it may reach; a
 * foreign or unknown one is a 404), the period in the owner's time zone and
 * its local hours. Without `from` the period starts on the first day with a
 * stop or move.
 */
export async function insightsScope(
  db: Executor,
  access: DeviceAccess & { user: { id: string; timezone: string } },
  query: {
    from?: string | undefined;
    to?: string | undefined;
    devices?: readonly string[] | undefined;
  },
  now = new Date(),
): Promise<InsightsScope> {
  const timezone = access.user.timezone;
  const deviceIds = (await resolveDeviceIds(db, access, query.devices)).map((device) => device.id);
  const first = query.from === undefined ? await firstSegmentAt(db, deviceIds) : null;
  const period = resolvePeriod(
    query,
    localDate(now, timezone),
    first === null ? null : localDate(new Date(first), timezone),
  );
  const hours = localHours(period.from, period.to, timezone);
  return {
    timezone,
    deviceIds,
    period,
    hours,
    start: new Date(hours[0]?.start ?? now.getTime()),
    end: new Date(hours.at(-1)?.end ?? now.getTime()),
  };
}
