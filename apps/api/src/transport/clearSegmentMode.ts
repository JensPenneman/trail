import type { Segment } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import type { Database } from "../db/database";
import { toIso } from "../db/toIso";
import type { DeviceAccess } from "../devices/deviceAccess";
import { lockDeviceProcessing } from "../processing/deviceLock";
import { enqueueWindow } from "../processing/processingQueue";
import { findSegment } from "./findSegment";
import { type SegmentRow, segmentColumns, toSegment } from "./segmentRow";

/**
 * Resets a move to the inferred mode (docs/architecture.md §17.5): the
 * override that set it is revoked — a quick toggle with it, for all the moves
 * it covered — and the segment shows the inferred mode at once. The span is
 * queued for the inference again (`queue`), which re-applies older overrides
 * and joins the parts an override had cut. Without an override nothing changes.
 * Returns the segment and the revoked spans.
 */
export async function clearSegmentMode(
  db: Database,
  access: DeviceAccess,
  segmentId: string,
  options: { queue: boolean },
): Promise<{ segment: Segment; revoked: { from: Date; to: Date }[] }> {
  const found = await findSegment(db, access, segmentId);
  return db.transaction(async (tx) => {
    await lockDeviceProcessing(tx, found.device_id);
    const segment = await findSegment(tx, access, segmentId, { forUpdate: true });
    const override = segment.features["override"];
    const overrideId =
      typeof override === "object" &&
      override !== null &&
      "id" in override &&
      typeof override.id === "string"
        ? override.id
        : null;
    const revoked = await tx.execute<{ from_at: string; to_at: string }>(sql`
      UPDATE mode_overrides SET revoked_at = now()
      WHERE device_id = ${segment.device_id} AND revoked_at IS NULL
        AND (id = ${overrideId}::uuid
          OR (kind = 'segment' AND from_at = ${segment.started_at}::timestamptz
            AND to_at = ${segment.ended_at}::timestamptz))
      RETURNING from_at::text, coalesce(to_at, greatest(now(), ${segment.ended_at}::timestamptz))::text AS to_at
    `);
    if (segment.mode_user === null && revoked.rows.length === 0) {
      return { segment: toSegment(segment), revoked: [] };
    }
    // `computed_at` moves with the mode, so the day's processed stamp does (docs/architecture.md §8.9).
    const updated = await tx.execute<SegmentRow>(sql`
      UPDATE segments s SET mode_user = NULL, mode = s.mode_inferred, computed_at = now(),
        features = jsonb_set(s.features, '{override}', 'null'::jsonb)
      WHERE s.id = ${segment.id}
      RETURNING ${segmentColumns}
    `);
    const spans = revoked.rows.map((row) => ({
      from: new Date(toIso(row.from_at)),
      to: new Date(toIso(row.to_at)),
    }));
    if (options.queue) {
      for (const span of spans) {
        await enqueueWindow(tx, {
          deviceId: segment.device_id,
          from: span.from,
          to: span.to,
          reason: "override",
          fromLevel: "inferred",
        });
      }
    }
    const row = updated.rows[0];
    if (row === undefined) throw new Error("The segment vanished under its lock");
    return { segment: toSegment(row), revoked: spans };
  });
}
