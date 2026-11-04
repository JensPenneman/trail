import { moveOverAfterS, moveOverHint } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { HttpError } from "../http/httpError";
import type { SegmentRow } from "./segmentRow";

/**
 * Refuses (409) a correction of a move that is still under way
 * (docs/architecture.md §17.5). A move is over once a later segment of the
 * device exists, or `moveOverAfterS` (the pipeline's `gapSplitS`) passed since
 * its last point and no point of the device after it waits to be processed:
 * only such a point can still extend it. A queue row is no sign of that (rows
 * waiting for map tiles, and the window a reset queues, re-read the same
 * points), and an upload committed but not yet queued is seen here. Stops are
 * not judged. Call it under the device lock, on the row read there.
 */
export async function assertMoveOver(tx: Executor, segment: SegmentRow): Promise<void> {
  if (segment.kind !== "move") return;
  const result = await tx.execute<{ over: boolean }>(sql`
    SELECT (
      EXISTS (
        SELECT 1 FROM segments s
        WHERE s.device_id = ${segment.device_id} AND s.started_at > ${segment.started_at}::timestamptz
      )
      OR (
        statement_timestamp() - ${segment.ended_at}::timestamptz >= make_interval(secs => ${moveOverAfterS})
        AND NOT EXISTS (
          SELECT 1 FROM locations l
          WHERE l.device_id = ${segment.device_id} AND l.recorded_at > ${segment.ended_at}::timestamptz
            AND NOT EXISTS (
              SELECT 1 FROM processed_points p
              WHERE p.device_id = l.device_id AND p.recorded_at = l.recorded_at
            )
        )
      )
    ) AS over
  `);
  if (result.rows[0]?.over !== true) {
    throw new HttpError(
      409,
      "conflict",
      `This move is still under way: its mode can be set or reset once it is over, ${moveOverHint}.`,
    );
  }
}
