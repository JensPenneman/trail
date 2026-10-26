import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { type DeviceAccess, mayReach } from "../devices/deviceAccess";
import { notFound } from "../http/httpError";
import { isUuid } from "../lib/isUuid";
import { type SegmentRow, segmentColumns } from "./segmentRow";

/**
 * A segment of a device the principal may reach; unknown, malformed, foreign
 * and withheld ids are all 404. `forUpdate` locks the row for the rest of the
 * transaction.
 */
export async function findSegment(
  db: Executor,
  access: DeviceAccess,
  segmentId: string,
  options: { forUpdate?: boolean } = {},
): Promise<SegmentRow & { features: Record<string, unknown> }> {
  if (!isUuid(segmentId)) throw notFound("No such segment.");
  const result = await db.execute<SegmentRow & { features: Record<string, unknown> }>(sql`
    SELECT ${segmentColumns}, s.features
    FROM segments s
    JOIN devices d ON d.id = s.device_id
    WHERE s.id = ${segmentId} AND d.user_id = ${access.user.id}
    ${options.forUpdate === true ? sql`FOR UPDATE OF s` : sql``}
  `);
  const row = result.rows[0];
  if (row === undefined || !mayReach(access, row.device_id)) throw notFound("No such segment.");
  return row;
}
