import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { toIso } from "../db/toIso";
import { heatDaysOf } from "./heatDaysOf";
import { rebuildHeatDays } from "./rebuildHeatDays";

/**
 * The per-day heat cells of the days a segment spans, after its mode changed
 * (docs/architecture.md §8.2), in the zone of the device's owner. The caller holds the device's
 * processing lock.
 */
export async function rebuildSegmentHeatDays(
  tx: Executor,
  deviceId: string,
  segment: { started_at: string; ended_at: string },
): Promise<void> {
  const owner = await tx.execute<{ timezone: string }>(sql`
    SELECT u.timezone FROM devices d JOIN users u ON u.id = d.user_id WHERE d.id = ${deviceId}::uuid
  `);
  const timezone = owner.rows[0]?.timezone;
  if (timezone === undefined) return;
  await rebuildHeatDays(
    tx,
    deviceId,
    timezone,
    heatDaysOf(new Date(toIso(segment.started_at)), new Date(toIso(segment.ended_at)), timezone),
  );
}
