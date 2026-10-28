import { createHash } from "node:crypto";
import type { CacheStamp, DayStamp } from "@trail/contracts/cacheStamp";
import type { DayStat } from "@trail/contracts/stats";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { toIso } from "../db/toIso";
import { tripTouches } from "../history/tripTouches";
import { visitTouches } from "../history/visitTouches";
import { addDays } from "../lib/calendarDate";
import { localDate } from "../lib/localDate";
import { segmentOverlaps } from "../transport/segmentOverlaps";

/*
 * Versions of the recipes below: a change to what goes into a stamp, or to how
 * a day's answers are built from the same rows (a track's simplification or
 * distance, the levels' assembly), bumps one, and every stamp changes with it
 * — a copy in a browser costs one refetch.
 */
const rawRecipe = 1;
const processedRecipe = 1;

/** One device's local day as the stamp query reads it (text for every instant and sum). */
export interface DayStampRow extends Record<string, unknown> {
  device_id: string;
  date: string;
  /** The daily statistics; null on a day without points. */
  points: number | null;
  distance_m: number | null;
  first_at: string | null;
  last_at: string | null;
  /** The device's counter and newest point, on the owner's current day only (else null). */
  points_total: string | null;
  last_recorded_at: string | null;
  /** Visits touching the day, and the sum of their recorded times (epoch seconds). */
  visits: number;
  visits_at: string | null;
  /** Trips touching the day, and the sum of their start times. */
  trips: number;
  trips_at: string | null;
  /** Segments overlapping the day: count, newest write, versions, sums of their bounds. */
  segments: number;
  computed_at: string | null;
  min_version: number | null;
  max_version: number | null;
  starts: string | null;
  ends: string | null;
  /** A window waiting for processing overlaps the day (`hasPendingWork`'s rule). */
  pending: boolean;
}

/** A device's local day with its stamp, and its daily statistics when it has points. */
export interface StampedDay {
  deviceId: string;
  date: string;
  stat: Omit<DayStat, "stamp"> | null;
  stamp: CacheStamp;
  /** What the stamp hashes: what the ETag of an answer made of this day hashes too. */
  canonical: { raw: string; processed: string };
}

const hash = (text: string): string =>
  createHash("sha256").update(text).digest("base64url").slice(0, 22);

const value = (part: string | number | null): string => (part === null ? "-" : String(part));

/**
 * The stamp of one device's local day (docs/architecture.md §8.9) and the
 * canonical strings it hashes. `raw` is what was recorded: the daily
 * statistics (points, distance, first and last point), the visits and trips
 * touching the day, and on the owner's current day the device's counter and
 * newest point, which an upload moves at once, while the statistics follow
 * after their debounce. `processed` is how it was worked out: the segments
 * overlapping the day — their count, newest write (`computed_at`, which a pass
 * and a mode correction move), versions and the sums of their bounds (a pass
 * cuts a segment of a neighbouring day without rewriting it) — and whether a
 * window waits for processing; null while the day has no segment. Both carry
 * the device, the day and the time zone, so they never stand for another day.
 */
export function stampDay(row: DayStampRow, timezone: string): Omit<StampedDay, "stat"> {
  const day = [row.device_id, row.date, timezone].join("|");
  const raw = [
    `raw${rawRecipe}`,
    day,
    value(row.points),
    value(row.distance_m),
    value(row.first_at),
    value(row.last_at),
    value(row.points_total),
    value(row.last_recorded_at),
    row.visits,
    value(row.visits_at),
    row.trips,
    value(row.trips_at),
  ].join("|");
  const processed = [
    `processed${processedRecipe}`,
    day,
    row.segments,
    value(row.computed_at),
    value(row.min_version),
    value(row.max_version),
    value(row.starts),
    value(row.ends),
    row.pending ? "pending" : "settled",
  ].join("|");
  return {
    deviceId: row.device_id,
    date: row.date,
    stamp: { raw: hash(raw), processed: row.segments === 0 ? null : hash(processed) },
    canonical: { raw, processed },
  };
}

/** The local days `[from, to)` intersects in `timezone`, oldest first. */
export function localDaysOf(range: { from: Date; to: Date }, timezone: string): string[] {
  const first = localDate(range.from, timezone);
  const last = localDate(
    new Date(Math.max(range.from.getTime(), range.to.getTime() - 1)),
    timezone,
  );
  const days: string[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}

const dayFrom = sql.raw("d.day_from");
const dayTo = sql.raw("d.day_to");

/**
 * The stamps of `dates` (local days in `timezone`) of `deviceIds`, by date then
 * device, with each day's statistics — in one statement: a range scan each of
 * `daily_stats`, `visits`, `trips`, `segments` and `processing_queue`, never
 * `locations` or `processed_points`. A row that spans days counts on every
 * day it touches, under the finders' own rules (`visitTouches`,
 * `tripTouches`, `segmentOverlaps`). Callers read the stamps before the data
 * they stamp: an upload between the two is then in the data but not yet in
 * the stamps, and the next comparison fetches once more — never the other way
 * round, which would let a copy pass for newer than it is.
 */
export async function loadStampedDays(
  db: Executor,
  input: { deviceIds: readonly string[]; timezone: string; dates: readonly string[] },
): Promise<StampedDay[]> {
  const { deviceIds, timezone, dates } = input;
  if (deviceIds.length === 0 || dates.length === 0) return [];
  const sorted = [...dates].sort();
  const firstDate = sorted[0] ?? "";
  const lastDate = sorted.at(-1) ?? firstDate;
  const ids = sql`${sql.param(deviceIds)}::uuid[]`;
  // The span of the asked days as instants: what each table is scanned for.
  const spanFrom = sql`(${firstDate}::date::timestamp AT TIME ZONE ${timezone})`;
  const spanTo = sql`((${lastDate}::date + 1)::timestamp AT TIME ZONE ${timezone})`;
  // The local days a row from `fromAt` to `toAt` may touch, within the span; the rule decides.
  const candidateDays = (fromAt: string, toAt: string) => sql`generate_series(
      greatest((${sql.raw(fromAt)} AT TIME ZONE ${timezone})::date, ${firstDate}::date)::timestamp,
      least((${sql.raw(toAt)} AT TIME ZONE ${timezone})::date, ${lastDate}::date)::timestamp,
      interval '1 day'
    )`;
  const result = await db.execute<DayStampRow>(sql`
    WITH days AS (
      SELECT device.id AS device_id, day.date,
        day.date::timestamp AT TIME ZONE ${timezone} AS day_from,
        (day.date + 1)::timestamp AT TIME ZONE ${timezone} AS day_to
      FROM unnest(${ids}) AS device(id)
      CROSS JOIN unnest(${sql.param(sorted)}::date[]) AS day(date)
    ),
    visit_days AS (
      SELECT d.device_id, d.date, count(*)::int AS n,
        sum(extract(epoch FROM v.recorded_at))::text AS at
      FROM visits v
      CROSS JOIN LATERAL ${candidateDays(
        "least(v.recorded_at, v.arrived_at)",
        "greatest(v.recorded_at, v.departed_at)",
      )} AS c(day)
      JOIN days d ON d.device_id = v.device_id AND d.date = c.day::date
        AND ${visitTouches("v", dayFrom, dayTo)}
      WHERE v.device_id = ANY(${ids}) AND ${visitTouches("v", spanFrom, spanTo)}
      GROUP BY d.device_id, d.date
    ),
    trip_days AS (
      SELECT d.device_id, d.date, count(*)::int AS n,
        sum(extract(epoch FROM t.started_at))::text AS at
      FROM trips t
      CROSS JOIN LATERAL ${candidateDays("t.started_at", "t.ended_at")} AS c(day)
      JOIN days d ON d.device_id = t.device_id AND d.date = c.day::date
        AND ${tripTouches("t", dayFrom, dayTo)}
      WHERE t.device_id = ANY(${ids}) AND ${tripTouches("t", spanFrom, spanTo)}
      GROUP BY d.device_id, d.date
    ),
    segment_days AS (
      SELECT d.device_id, d.date, count(*)::int AS n, max(s.computed_at)::text AS computed_at,
        min(s.version)::int AS min_version, max(s.version)::int AS max_version,
        sum(extract(epoch FROM s.started_at))::text AS starts,
        sum(extract(epoch FROM s.ended_at))::text AS ends
      FROM segments s
      CROSS JOIN LATERAL ${candidateDays("s.started_at", "s.ended_at")} AS c(day)
      JOIN days d ON d.device_id = s.device_id AND d.date = c.day::date
        AND ${segmentOverlaps("s", dayFrom, dayTo)}
      WHERE s.device_id = ANY(${ids}) AND ${segmentOverlaps("s", spanFrom, spanTo)}
      GROUP BY d.device_id, d.date
    ),
    pending_days AS (
      SELECT DISTINCT d.device_id, d.date
      FROM processing_queue q
      CROSS JOIN LATERAL ${candidateDays("q.from_at", "q.to_at")} AS c(day)
      JOIN days d ON d.device_id = q.device_id AND d.date = c.day::date
        AND q.from_at < d.day_to AND q.to_at > d.day_from
      WHERE q.device_id = ANY(${ids}) AND q.missing_tiles IS NULL
        AND q.from_at < ${spanTo} AND q.to_at > ${spanFrom}
    )
    SELECT d.device_id, d.date::text AS date,
      ds.points, ds.distance_m, ds.first_at::text AS first_at, ds.last_at::text AS last_at,
      device.points_total::text AS points_total, device.last_recorded_at::text AS last_recorded_at,
      coalesce(vd.n, 0) AS visits, vd.at AS visits_at,
      coalesce(td.n, 0) AS trips, td.at AS trips_at,
      coalesce(sd.n, 0) AS segments, sd.computed_at, sd.min_version, sd.max_version, sd.starts,
      sd.ends,
      pd.device_id IS NOT NULL AS pending
    FROM days d
    LEFT JOIN daily_stats ds ON ds.device_id = d.device_id AND ds.date = d.date
    LEFT JOIN devices device ON device.id = d.device_id
      AND d.date = (now() AT TIME ZONE ${timezone})::date
    LEFT JOIN visit_days vd ON vd.device_id = d.device_id AND vd.date = d.date
    LEFT JOIN trip_days td ON td.device_id = d.device_id AND td.date = d.date
    LEFT JOIN segment_days sd ON sd.device_id = d.device_id AND sd.date = d.date
    LEFT JOIN pending_days pd ON pd.device_id = d.device_id AND pd.date = d.date
    ORDER BY d.date, d.device_id
  `);
  return result.rows.map((row) => ({
    ...stampDay(row, timezone),
    stat:
      row.points === null || row.first_at === null || row.last_at === null
        ? null
        : {
            date: row.date,
            deviceId: row.device_id,
            points: row.points,
            distanceM: row.distance_m ?? 0,
            firstAt: toIso(row.first_at),
            lastAt: toIso(row.last_at),
          },
  }));
}

/** The stamps of an answer: every device and local day it covers. */
export const dayStampsOf = (days: readonly StampedDay[]): DayStamp[] =>
  days.map((day) => ({ deviceId: day.deviceId, date: day.date, ...day.stamp }));

/**
 * What an answer made of `days` hashes into its ETag: the raw canonical strings
 * for what depends on the recorded rows only (tracks at the raw level, visits,
 * trips), both for what depends on processing too. The processed string is
 * there even while the stamp is null, so a window that starts to wait changes
 * the ETag of a day without segments as well.
 */
export const dayValidator = (
  days: readonly StampedDay[],
  parts: "raw" | "processed" = "raw",
): string[] =>
  days.map((day) =>
    parts === "raw" ? day.canonical.raw : `${day.canonical.raw}\n${day.canonical.processed}`,
  );
