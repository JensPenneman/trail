import { createHash } from "node:crypto";
import type { CacheStamp, DayStamp } from "@trail/contracts/cacheStamp";
import type { DayStat } from "@trail/contracts/stats";
import { type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "../db/database";
import { toIso } from "../db/toIso";
import { tripTouches } from "../history/tripTouches";
import { visitTouches } from "../history/visitTouches";
import { addDays } from "../lib/calendarDate";
import { localDate } from "../lib/localDate";
import { stayPartsSql } from "../processing/stayParts";

/*
 * Versions of the recipes below: a change to what goes into a stamp, or to how
 * a day's answers are built from the same rows (a track's simplification or
 * distance, the levels' assembly), bumps one, and every stamp changes with it
 * — a copy in a browser costs one refetch.
 */
const rawRecipe = 1;
const processedRecipe = 2;

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
  /**
   * The stored segments of the stays overlapping the day — every part of a
   * stay the timeline serves as one stop, wherever it lies (`stayPartsSql`) —
   * their count, newest write, versions, sums of their bounds and points.
   */
  segments: number;
  computed_at: string | null;
  min_version: number | null;
  max_version: number | null;
  starts: string | null;
  ends: string | null;
  points_of_parts: string | null;
  /** A window waiting for processing overlaps the day, or a stay overlapping it. */
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
 * after their debounce. `processed` is how it was worked out: the stored
 * segments of the stays overlapping the day — every part of a stay served as
 * one stop, also those on other days — their count, newest write
 * (`computed_at`, which a pass and a mode correction move), versions and the
 * sums of their bounds (a pass cuts a segment of a neighbouring day without
 * rewriting it) and points — and whether a window waits for processing over
 * the day or such a stay; null while the day has no segment. Both carry
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
    value(row.points_of_parts),
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

const dialect = new PgDialect();

/**
 * The statement is prepared by name on each connection — its text is the same
 * every time, only the parameters change — so it is parsed once per
 * connection rather than with every request: a third of its cost, and the
 * stamps are most of what a 304 reads. node-postgres sends the text only the
 * first time a connection sees a name, so the name comes from the text: an
 * edited statement is a new one, never the old text run under its name.
 */
const statementNameOf = (text: string): string =>
  `trail_day_stamps_${createHash("sha256").update(text).digest("hex").slice(0, 16)}`;

/**
 * The stamps of `dates` (local days in `timezone`) of `deviceIds`, by date then
 * device, with each day's statistics — in one statement: a range scan each of
 * `daily_stats`, `visits`, `trips`, `segments` and `processing_queue`, never
 * `locations` or `processed_points`. A row that spans days counts on every
 * day it touches, under the finders' own rules (`visitTouches`,
 * `tripTouches`; a segment on every day its stay overlaps, `stayPartsSql`). Callers read the stamps before the data
 * they stamp: an upload between the two is then in the data but not yet in
 * the stamps, and the next comparison fetches once more — never the other way
 * round, which would let a copy pass for newer than it is.
 */
export async function loadStampedDays(
  db: Database,
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
  // The local days a row from `fromAt` to `toAt` may touch, within the span (`c.day`, a local
  // midnight); the row's own rule then decides, between `dayFrom` and `dayTo`.
  const candidateDays = (fromAt: string, toAt: string) => sql`generate_series(
      greatest((${sql.raw(fromAt)} AT TIME ZONE ${timezone})::date, ${firstDate}::date)::timestamp,
      least((${sql.raw(toAt)} AT TIME ZONE ${timezone})::date, ${lastDate}::date)::timestamp,
      interval '1 day'
    )`;
  const dayFrom = sql`(c.day AT TIME ZONE ${timezone})`;
  const dayTo = sql`((c.day + interval '1 day') AT TIME ZONE ${timezone})`;
  // A stay counts on a day its extent overlaps — `segmentOverlaps` of the stop the timeline serves.
  const stayOverlaps = (alias: string, from: SQL, to: SQL) =>
    sql`(${sql.raw(alias)}.stay_from < ${to} AND ${sql.raw(alias)}.stay_to > ${from})`;
  // One row per table row and day it counts on, every column of the others null: a union and
  // one aggregate rather than a join of six, which took Postgres longer to plan than to run.
  const statement = dialect.sqlToQuery(sql`
    WITH days AS (
      SELECT device.id AS device_id, day.date
      FROM unnest(${ids}) AS device(id)
      CROSS JOIN unnest(${sql.param(sorted)}::date[]) AS day(date)
    ),
    stay_parts AS (SELECT * FROM ${stayPartsSql(ids, spanFrom, spanTo)} parts),
    facts (device_id, date, points, distance_m, first_at, last_at, points_total, last_recorded_at,
      visit, visit_at, trip, trip_at, segment, computed_at, version, start_at, end_at, pending,
      part_points) AS (
      SELECT ds.device_id, ds.date, ds.points, ds.distance_m, ds.first_at::text, ds.last_at::text,
        NULL::text, NULL::text, NULL::int, NULL::numeric, NULL::int, NULL::numeric, NULL::int,
        NULL::timestamptz, NULL::int, NULL::numeric, NULL::numeric, NULL::boolean, NULL::int
      FROM daily_stats ds
      WHERE ds.device_id = ANY(${ids}) AND ds.date BETWEEN ${firstDate}::date AND ${lastDate}::date
      UNION ALL
      SELECT device.id, (now() AT TIME ZONE ${timezone})::date, NULL, NULL, NULL, NULL,
        device.points_total::text, device.last_recorded_at::text, NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL
      FROM devices device
      WHERE device.id = ANY(${ids})
      UNION ALL
      SELECT v.device_id, c.day::date, NULL, NULL, NULL, NULL, NULL, NULL,
        1, extract(epoch FROM v.recorded_at), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM visits v
      CROSS JOIN LATERAL ${candidateDays(
        "least(v.recorded_at, v.arrived_at)",
        "greatest(v.recorded_at, v.departed_at)",
      )} AS c(day)
      WHERE v.device_id = ANY(${ids}) AND ${visitTouches("v", spanFrom, spanTo)}
        AND ${visitTouches("v", dayFrom, dayTo)}
      UNION ALL
      SELECT t.device_id, c.day::date, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        1, extract(epoch FROM t.started_at), NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM trips t
      CROSS JOIN LATERAL ${candidateDays("t.started_at", "t.ended_at")} AS c(day)
      WHERE t.device_id = ANY(${ids}) AND ${tripTouches("t", spanFrom, spanTo)}
        AND ${tripTouches("t", dayFrom, dayTo)}
      UNION ALL
      SELECT s.device_id, c.day::date, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        1, s.computed_at, s.version, extract(epoch FROM s.started_at), extract(epoch FROM s.ended_at),
        NULL, s.point_count
      FROM stay_parts s
      CROSS JOIN LATERAL ${candidateDays("s.stay_from", "s.stay_to")} AS c(day)
      WHERE ${stayOverlaps("s", spanFrom, spanTo)} AND ${stayOverlaps("s", dayFrom, dayTo)}
      UNION ALL
      SELECT q.device_id, c.day::date, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, true, NULL
      FROM processing_queue q
      CROSS JOIN LATERAL ${candidateDays("q.from_at", "q.to_at")} AS c(day)
      WHERE q.device_id = ANY(${ids}) AND q.missing_tiles IS NULL
        AND q.from_at < ${spanTo} AND q.to_at > ${spanFrom}
        AND q.from_at < ${dayTo} AND q.to_at > ${dayFrom}
      UNION ALL
      -- A window over any part of a stay waits for the days the stay's stop is served on, too.
      SELECT st.device_id, c.day::date, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, true, NULL
      FROM (SELECT DISTINCT device_id, stay_from, stay_to FROM stay_parts) st
      CROSS JOIN LATERAL ${candidateDays("st.stay_from", "st.stay_to")} AS c(day)
      WHERE ${stayOverlaps("st", spanFrom, spanTo)} AND ${stayOverlaps("st", dayFrom, dayTo)}
        AND EXISTS (
          SELECT 1 FROM processing_queue q
          WHERE q.device_id = st.device_id AND q.missing_tiles IS NULL
            AND q.from_at < st.stay_to AND q.to_at > st.stay_from
        )
    )
    SELECT d.device_id, d.date::text AS date,
      max(f.points) AS points, max(f.distance_m) AS distance_m, max(f.first_at) AS first_at,
      max(f.last_at) AS last_at, max(f.points_total) AS points_total,
      max(f.last_recorded_at) AS last_recorded_at,
      coalesce(sum(f.visit), 0)::int AS visits, sum(f.visit_at)::text AS visits_at,
      coalesce(sum(f.trip), 0)::int AS trips, sum(f.trip_at)::text AS trips_at,
      coalesce(sum(f.segment), 0)::int AS segments, max(f.computed_at)::text AS computed_at,
      min(f.version) AS min_version, max(f.version) AS max_version,
      sum(f.start_at)::text AS starts, sum(f.end_at)::text AS ends,
      sum(f.part_points)::text AS points_of_parts,
      coalesce(bool_or(f.pending), false) AS pending
    FROM days d
    LEFT JOIN facts f ON f.device_id = d.device_id AND f.date = d.date
    GROUP BY d.device_id, d.date
    ORDER BY d.date, d.device_id
  `);
  const result = await db.$client.query<DayStampRow>({
    name: statementNameOf(statement.sql),
    text: statement.sql,
    values: statement.params,
  });
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
