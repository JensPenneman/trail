import type { Transaction } from "../db/database";
import { refusedDataCode } from "../db/refusedDataCode";
import { deadLetterRecord } from "./deadLetterRecord";
import { insertPreparedRecords } from "./insertPreparedRecords";
import type { PreparedBatch } from "./preparedBatch";
import type { StoredRecords } from "./storedRecords";

/** One record of an upload, prepared on its own. */
export interface SingleRecord {
  /** As the dead letter keeps it when the database refuses it. */
  record: unknown;
  batch: PreparedBatch;
}

/**
 * The fallback after Postgres refused a value of a batch that the normalisation
 * let through: every record is stored on its own, in a savepoint, and a record
 * the database refuses goes to the dead letter with the SQLSTATE. The rest of
 * the upload is stored and acknowledged — one poison record must never wedge
 * the phone's queue (the apps resend an unacknowledged upload for weeks).
 */
export async function insertRecordByRecord(
  tx: Transaction,
  deviceId: string,
  singles: readonly SingleRecord[],
): Promise<StoredRecords> {
  const stored: StoredRecords = {
    inserted: [],
    visits: 0,
    trips: 0,
    events: 0,
    locationRecords: 0,
    rejects: [],
  };
  for (const single of singles) {
    try {
      const result = await tx.transaction((savepoint) =>
        insertPreparedRecords(savepoint, deviceId, single.batch),
      );
      stored.inserted.push(...result.inserted);
      stored.visits += result.visits;
      stored.trips += result.trips;
      stored.events += result.events;
      stored.locationRecords += result.locationRecords;
      stored.rejects.push(...result.rejects);
    } catch (error) {
      const code = refusedDataCode(error);
      if (code === null) throw error;
      stored.rejects.push({
        reason: `refused by the database (SQLSTATE ${code})`,
        record: deadLetterRecord(single.record),
      });
    }
  }
  stored.inserted.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  return stored;
}
