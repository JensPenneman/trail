import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import type { RejectedRecord } from "./preparedBatch";

/** Keeps invalid records in the dead-letter table (kept forever) instead of dropping them. */
export async function insertRejects(
  tx: Executor,
  deviceId: string,
  rejects: readonly RejectedRecord[],
  receivedAt: Date,
): Promise<void> {
  if (rejects.length === 0) return;
  const rows = JSON.stringify(rejects.map(({ reason, record }) => ({ reason, record })));
  await tx.execute(sql`
    INSERT INTO ingest_rejects (device_id, received_at, reason, record)
    SELECT ${deviceId}::uuid, ${receivedAt.toISOString()}::timestamptz, r.reason, r.record
    FROM jsonb_to_recordset(${rows}::jsonb) AS r(reason text, record jsonb)
  `);
}
