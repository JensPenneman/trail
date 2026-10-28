import { type SQL, sql } from "drizzle-orm";

/*
 * The parts of a stay (docs/architecture.md §17.6). Bounded passes work a long
 * stay out a part at a time, so it is stored as stops of one device one after
 * the other. A stop continues the segment right before it — the two are one
 * stay — where both are stops and the next begins as the one before ends,
 * within 300 m of where it ended (the parts of one pass share their boundary
 * point, or follow a stop that lasted beyond its last point), or, a short hole
 * apart (no travel gap), where their middles lie within the larger of their
 * spreads or 100 m. The timeline serves such stops as one (`servedSegments`)
 * and the quick toggle counts them as one (`endsToggleSql`, `applyOverrides`):
 * one rule, in SQL for stored segments and in TypeScript for a pass's own.
 */

/** A recording gap longer than this … */
const travelGapS = 1800;
/**
 * … whose ends lie farther apart than this is travel (§17.3): the stops on
 * either side are two. Stops that meet are one stay unless the phone was this
 * far away when the next began (§17.3's pause: no stay holds such a jump).
 */
const travelGapM = 300;
/** Stops a short hole apart are one place when their middles lie within their spread, or this. */
const samePlaceM = 100;

interface Position {
  lat: number;
  lon: number;
}

/** What the rule reads of a stop: its times (epoch seconds), ends and middle, and its spread. */
export interface StopShape {
  startT: number;
  endT: number;
  start: Position;
  end: Position;
  centroid: Position;
  spreadM: number | null;
}

/** Metres between two close positions (equirectangular), as `metresSql` reckons them. */
export function metresBetween(from: Position, to: Position): number {
  const cosine = Math.cos((from.lat * Math.PI) / 180);
  return 111195 * Math.sqrt((to.lat - from.lat) ** 2 + (cosine * (to.lon - from.lon)) ** 2);
}

/** Whether stop `part` continues stop `before`, the segment right before it: one stay. */
export function continuesStop(before: StopShape, part: StopShape): boolean {
  const jumpM = metresBetween(before.end, part.start);
  if (part.startT === before.endT && jumpM <= travelGapM) return true;
  const travel = part.startT - before.endT > travelGapS && jumpM > travelGapM;
  return (
    !travel &&
    metresBetween(before.centroid, part.centroid) <=
      Math.max(before.spreadM ?? 0, part.spreadM ?? 0, samePlaceM)
  );
}

/** SQL expressions of the columns the rule reads of a segment. */
export interface StopColumns {
  kind: string;
  startedAt: string;
  endedAt: string;
  startLat: string;
  startLon: string;
  endLat: string;
  endLon: string;
  centroidLat: string;
  centroidLon: string;
  spreadM: string;
}

/** The columns of stored segment `alias` (an alias of `segments`). */
const storedColumns = (alias: string): StopColumns => ({
  kind: `${alias}.kind`,
  startedAt: `${alias}.started_at`,
  endedAt: `${alias}.ended_at`,
  startLat: `${alias}.start_lat`,
  startLon: `${alias}.start_lon`,
  endLat: `${alias}.end_lat`,
  endLon: `${alias}.end_lon`,
  centroidLat: `${alias}.centroid_lat`,
  centroidLon: `${alias}.centroid_lon`,
  spreadM: `(${alias}.features->>'spreadM')::float8`,
});

/** Metres between two positions given as SQL expressions (`metresBetween`). */
const metresSql = (lat1: string, lon1: string, lat2: string, lon2: string): SQL =>
  sql.raw(`(111195 * sqrt(power(${lat2} - ${lat1}, 2)
    + power(cos(radians(${lat1})) * (${lon2} - ${lon1}), 2)))`);

/** `continuesStop` in SQL, of column expressions: false where either is missing. */
export function continuesSql(
  before: Omit<StopColumns, "startedAt" | "startLat" | "startLon">,
  part: Omit<StopColumns, "endedAt" | "endLat" | "endLon">,
): SQL {
  const column = sql.raw;
  const jump = metresSql(before.endLat, before.endLon, part.startLat, part.startLon);
  return sql`coalesce(${column(part.kind)} = 'stop' AND ${column(before.kind)} = 'stop' AND (
      (${column(part.startedAt)} = ${column(before.endedAt)} AND ${jump} <= ${travelGapM})
      OR (NOT (${column(part.startedAt)} - ${column(before.endedAt)}
            > ${travelGapS}::integer * interval '1 second'
          AND ${jump} > ${travelGapM})
        AND ${metresSql(before.centroidLat, before.centroidLon, part.centroidLat, part.centroidLon)}
          <= greatest(coalesce(${column(before.spreadM)}, 0), coalesce(${column(part.spreadM)}, 0),
            ${samePlaceM}))
    ), false)`;
}

/** Whether stored segment `alias` continues the segment of its device right before it. */
export function continuesBeforeSql(alias: string): SQL {
  const part = sql.raw(alias);
  return sql`coalesce((
    SELECT ${continuesSql(storedColumns("stay_before"), storedColumns(alias))}
    FROM segments stay_before
    WHERE stay_before.device_id = ${part}.device_id AND stay_before.started_at < ${part}.started_at
    ORDER BY stay_before.started_at DESC
    LIMIT 1
  ), false)`;
}

/**
 * When the stay of stored segment `alias` began — the latest segment of its
 * device up to it that continues none before it — if that was after `since`;
 * null where the stay began at or before `since` (looked for no further back).
 */
export function stayStartedAfterSql(alias: string, since: SQL): SQL {
  const part = sql.raw(alias);
  return sql`(
    SELECT stay_part.started_at FROM segments stay_part
    WHERE stay_part.device_id = ${part}.device_id
      AND stay_part.started_at <= ${part}.started_at AND stay_part.started_at > ${since}
      AND NOT ${continuesBeforeSql("stay_part")}
    ORDER BY stay_part.started_at DESC
    LIMIT 1
  )`;
}
