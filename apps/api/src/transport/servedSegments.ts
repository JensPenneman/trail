import { type SQL, sql } from "drizzle-orm";
import { stayPartsSql } from "../processing/stayParts";

/*
 * A stay is one stop (docs/architecture.md §17.6). Bounded passes work a long
 * stay out a part at a time — a pass takes on at most 60 000 points and 36
 * hours, and grows at most two days into a segment — so its parts are
 * consecutive stops of one device that meet. Read as they are stored, a
 * week at home would be five stops at one place and Insights would count
 * them all; read through this they are one again (the rule: `stayParts`).
 * Nothing is changed in the stored segments: processing stays as it is, every
 * pass repeatable.
 */

/**
 * The segments of `deviceIds` around `[from, to)` as they are served, a
 * subquery aliased `s` with the columns of `SegmentRow` (`servedColumns`):
 * consecutive stops of a device are one stop where the next begins as the one
 * before ends within 300 m of where it ended — the parts of one stay, which
 * share their boundary point or follow a stop that lasted beyond its last
 * point — or, a short hole apart (no travel gap), where their middles lie
 * within the larger of their spreads or 100 m. One stop runs from the first
 * part's start to the last part's end, under the first part's id, its points
 * counted once (a point two parts share, once) and its middle weighed by
 * them; every other segment as it is stored. The parts of a stay are found
 * up to two weeks beyond the range (a longer stay is served from its earliest
 * part within them); the caller keeps what overlaps the range, orders and pages.
 */
export function servedSegments(deviceIds: readonly string[], range: { from: Date; to: Date }): SQL {
  const parts = stayPartsSql(
    sql`${sql.param(deviceIds)}::uuid[]`,
    sql`${range.from.toISOString()}::timestamptz`,
    sql`${range.to.toISOString()}::timestamptz`,
  );
  return sql`(
    SELECT (array_agg(id ORDER BY started_at))[1] AS id, device_id, min(kind) AS kind,
      min(started_at) AS started_at, max(ended_at) AS ended_at,
      CASE WHEN count(*) = 1 THEN min(duration_s)
        ELSE extract(epoch FROM max(ended_at) - min(started_at))::integer END AS duration_s,
      sum(distance_m) AS distance_m,
      (array_agg(mode ORDER BY started_at))[1] AS mode,
      (array_agg(mode_inferred ORDER BY started_at))[1] AS mode_inferred,
      (array_agg(mode_user ORDER BY started_at))[1] AS mode_user,
      (array_agg(confidence ORDER BY started_at))[1] AS confidence,
      (array_agg(review ORDER BY started_at))[1] AS review,
      (array_agg(max_speed ORDER BY started_at))[1] AS max_speed,
      (sum(point_count) - count(*) FILTER (WHERE shares_point))::integer AS point_count,
      (array_agg(start_lat ORDER BY started_at))[1] AS start_lat,
      (array_agg(start_lon ORDER BY started_at))[1] AS start_lon,
      (array_agg(end_lat ORDER BY started_at DESC))[1] AS end_lat,
      (array_agg(end_lon ORDER BY started_at DESC))[1] AS end_lon,
      coalesce(sum(centroid_lat * point_count) / nullif(sum(point_count), 0), avg(centroid_lat))
        AS centroid_lat,
      coalesce(sum(centroid_lon * point_count) / nullif(sum(point_count), 0), avg(centroid_lon))
        AS centroid_lon,
      max(spread_m) AS spread_m,
      (array_agg(last_point_t ORDER BY started_at DESC))[1] AS last_point_t
    FROM ${parts} stays
    GROUP BY device_id, stay
  ) s`;
}

/** The columns of `SegmentRow` from `servedSegments` (as `segmentColumns` selects them from `segments`). */
export const servedColumns = sql.raw(`
  s.id, s.device_id, s.kind, s.started_at::text, s.ended_at::text, s.duration_s, s.distance_m,
  s.mode, s.mode_inferred, s.mode_user, s.confidence, s.review, s.max_speed, s.point_count,
  s.start_lat, s.start_lon, s.end_lat, s.end_lon, s.centroid_lat, s.centroid_lon, s.spread_m,
  s.last_point_t
`);
