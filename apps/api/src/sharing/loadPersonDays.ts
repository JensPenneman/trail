import type { PersonDaysResponse } from "@trail/contracts/person";
import { sql } from "drizzle-orm";
import type { AppContext } from "../appContext";
import { notFound } from "../http/httpError";
import { addDays } from "../lib/calendarDate";
import { startOfLocalDay } from "../lib/startOfLocalDay";
import {
  grantsViewer,
  mayReadPeople,
  resolveAccessibleDevices,
  type Viewer,
} from "./accessibleDevices";
import { personDaysWindow } from "./personDaysWindow";
import { touchShareViews } from "./touchShareViews";

interface GrantRow extends Record<string, unknown> {
  id: string;
  precision: string;
  history_days: number | null;
  timezone: string;
}

interface DayRow extends Record<string, unknown> {
  device_id: string;
  date: string;
  points: number;
  first_at: string;
  last_at: string;
}

/**
 * The days a person recorded something, for a share with history: per shared
 * device and local day (the person's own time zone) of the history window,
 * the points and the first and last time — from the daily statistics, no
 * position. The window's first day, when the history begins in the middle of
 * it, is counted from there only. Who may ask, and which shares count, is
 * decided exactly as for the person's track: someone who does not share with
 * the viewer, shares no history, or is hidden by the viewer, is a 404.
 */
export async function loadPersonDays(
  ctx: AppContext,
  viewer: Viewer,
  userId: string,
): Promise<{ days: PersonDaysResponse; shareId: string; deviceIds: string[] }> {
  const now = new Date();
  if (!mayReadPeople(viewer)) throw notFound("No such person.");
  const { rows } = await ctx.db.execute<GrantRow>(sql`
    SELECT s.id, s.precision, s.history_days, u.timezone
    FROM shares s JOIN users u ON u.id = s.owner_user_id
    WHERE ${grantsViewer(viewer.user.id, now)} AND s.owner_user_id = ${userId}
    LIMIT 1
  `);
  const [grant] = rows;
  if (grant === undefined) throw notFound("No such person.");
  if (grant.history_days === null || grant.precision !== "precise") {
    throw notFound("This person shares no history with you.");
  }
  const devices = (
    await resolveAccessibleDevices(ctx, viewer, undefined, { now, ownDevices: false })
  ).filter((device) => device.shareId === grant.id);
  const deviceIds = devices.map((device) => device.deviceId);
  const window = personDaysWindow(grant.history_days, now, grant.timezone, ctx.config);

  const body: PersonDaysResponse = {
    timezone: grant.timezone,
    window: { from: window.from, to: window.to },
    days: [],
  };
  if (deviceIds.length > 0) {
    const ids = sql`${sql.param(deviceIds)}::uuid[]`;
    // The first day whole comes from the statistics; a day cut by the history's start is counted
    // from there, in the locations themselves (one day, a few devices).
    const whole = await ctx.db.execute<DayRow>(sql`
      SELECT device_id, date::text AS date, points, first_at::text AS first_at, last_at::text AS last_at
      FROM daily_stats
      WHERE device_id = ANY(${ids})
        AND date BETWEEN ${window.partialFrom === null ? window.from : addDays(window.from, 1)}::date
          AND ${window.to}::date
        AND points > 0
    `);
    const cut =
      window.partialFrom === null
        ? []
        : (
            await ctx.db.execute<DayRow>(sql`
              SELECT device_id, ${window.from}::text AS date, count(*)::int AS points,
                min(recorded_at)::text AS first_at, max(recorded_at)::text AS last_at
              FROM locations
              WHERE device_id = ANY(${ids})
                AND recorded_at >= ${window.partialFrom.toISOString()}::timestamptz
                AND recorded_at < ${new Date(startOfLocalDay(addDays(window.from, 1), grant.timezone)).toISOString()}::timestamptz
              GROUP BY device_id
            `)
          ).rows;
    body.days = [...cut, ...whole.rows]
      .map((row) => ({
        date: row.date,
        deviceId: row.device_id,
        points: row.points,
        firstAt: new Date(row.first_at).toISOString(),
        lastAt: new Date(row.last_at).toISOString(),
      }))
      .sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : a.deviceId < b.deviceId ? -1 : 1,
      );
  }
  touchShareViews(ctx, [grant.id]);
  return { days: body, shareId: grant.id, deviceIds };
}
