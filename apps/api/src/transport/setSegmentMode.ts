import type { ChosenMode, ModeOverrideSource, Segment } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import type { Database } from "../db/database";
import type { DeviceAccess } from "../devices/deviceAccess";
import { HttpError } from "../http/httpError";
import { lockDeviceProcessing } from "../processing/deviceLock";
import { findSegment } from "./findSegment";
import { type SegmentRow, segmentColumns, toSegment } from "./segmentRow";

/**
 * Sets the mode of one move (docs/architecture.md §17.5): a `segment` override
 * for its span, applied to the segment at once and again whenever the window
 * is processed. Setting the mode it already has from such an override changes
 * nothing. A stop has no mode: 409.
 */
export async function setSegmentMode(
  db: Database,
  access: DeviceAccess,
  segmentId: string,
  mode: ChosenMode,
  source: ModeOverrideSource,
): Promise<Segment> {
  const found = await findSegment(db, access, segmentId);
  if (found.kind === "stop") {
    throw new HttpError(409, "conflict", "A stop has no transport mode; set the mode of a move.");
  }
  return db.transaction(async (tx) => {
    await lockDeviceProcessing(tx, found.device_id);
    // Read again under the lock: a window processed meanwhile may have replaced it.
    const segment = await findSegment(tx, access, segmentId, { forUpdate: true });
    const existing = await tx.execute<{ id: string; mode: ChosenMode }>(sql`
      SELECT id, mode FROM mode_overrides
      WHERE device_id = ${segment.device_id} AND kind = 'segment' AND revoked_at IS NULL
        AND from_at = ${segment.started_at}::timestamptz AND to_at = ${segment.ended_at}::timestamptz
      ORDER BY created_at DESC
    `);
    const same = existing.rows.find((row) => row.mode === mode);
    if (same !== undefined && segment.mode_user === mode) return toSegment(segment);
    await tx.execute(sql`
      UPDATE mode_overrides SET revoked_at = now()
      WHERE device_id = ${segment.device_id} AND kind = 'segment' AND revoked_at IS NULL
        AND from_at = ${segment.started_at}::timestamptz AND to_at = ${segment.ended_at}::timestamptz
    `);
    const created = await tx.execute<{ id: string }>(sql`
      INSERT INTO mode_overrides (device_id, kind, from_at, to_at, mode, source, created_by)
      VALUES (${segment.device_id}, 'segment', ${segment.started_at}::timestamptz,
        ${segment.ended_at}::timestamptz, ${mode}, ${source}, ${access.user.id})
      RETURNING id
    `);
    const overrideId = created.rows[0]?.id ?? null;
    // `computed_at` moves with the mode, so the day's processed stamp does (docs/architecture.md §8.9).
    const updated = await tx.execute<SegmentRow>(sql`
      UPDATE segments s SET mode_user = ${mode}, mode = ${mode}, computed_at = now(),
        features = s.features || jsonb_build_object('override',
          jsonb_build_object('id', ${overrideId}::text, 'kind', 'segment', 'source', ${source}::text))
      WHERE s.id = ${segment.id}
      RETURNING ${segmentColumns}
    `);
    const row = updated.rows[0];
    if (row === undefined) throw new Error("The segment vanished under its lock");
    return toSegment(row);
  });
}
