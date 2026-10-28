import type { TimelineResponse } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import type { DeviceAccess } from "../devices/deviceAccess";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";
import { hasPendingWork } from "../processing/processingQueue";
import { type SegmentRow, toSegment } from "./segmentRow";
import { servedColumns, servedSegments } from "./servedSegments";
import { decodeTimelineCursor, encodeTimelineCursor } from "./timelineCursor";

/**
 * The timeline (docs/architecture.md §17.6): the stops and moves of the
 * principal's (or the requested) devices overlapping `[from, to)`, oldest
 * first, a page at a time (keyset on start and device) — a stay one stop,
 * however many passes worked it out (`servedSegments`).
 */
export async function loadTimeline(
  db: Executor,
  access: DeviceAccess,
  query: {
    devices?: readonly string[] | undefined;
    from: Date;
    to: Date;
    cursor?: string | undefined;
    limit: number;
  },
): Promise<TimelineResponse> {
  const owned = await resolveDeviceIds(db, access, query.devices);
  const ids = owned.map((device) => device.id);
  if (ids.length === 0) return { items: [], nextCursor: null, pending: false };
  const cursor = query.cursor === undefined ? null : decodeTimelineCursor(query.cursor);
  const rows = await db.execute<SegmentRow>(sql`
    SELECT ${servedColumns}
    FROM ${servedSegments(ids, query)}
    WHERE s.started_at < ${query.to.toISOString()}::timestamptz
      AND s.ended_at > ${query.from.toISOString()}::timestamptz
      ${
        cursor === null
          ? sql``
          : sql`AND (s.started_at, s.device_id) > (${cursor.startedAt}::timestamptz, ${cursor.deviceId}::uuid)`
      }
    ORDER BY s.started_at, s.device_id
    LIMIT ${query.limit + 1}
  `);
  const page = rows.rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toSegment),
    nextCursor:
      rows.rows.length > query.limit && last !== undefined
        ? encodeTimelineCursor({ startedAt: toSegment(last).startedAt, deviceId: last.device_id })
        : null,
    pending: await hasPendingWork(db, ids, query.from, query.to),
  };
}
