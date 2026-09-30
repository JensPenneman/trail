import type { Transaction } from "../db/database";
import { refusedDataCode } from "../db/refusedDataCode";
import { deadLetterRecord } from "./deadLetterRecord";
import { insertPreparedRecords } from "./insertPreparedRecords";
import type { OverlandPayload } from "./overlandPayload";
import { prepareBatch } from "./prepareBatch";
import type { StoredRecords } from "./storedRecords";

/**
 * The fallback after Postgres refused a value of a batch that the normalisation
 * let through: every record is prepared and stored on its own, in a savepoint,
 * and a record the database refuses goes to the dead letter with the SQLSTATE.
 * The rest of the upload is stored and acknowledged — one poison record must
 * never wedge the phone's queue (Overland resends an unacknowledged batch forever).
 */
export async function insertRecordByRecord(
  tx: Transaction,
  deviceId: string,
  payload: OverlandPayload,
  receivedAt: Date,
): Promise<StoredRecords> {
  const stored: StoredRecords = {
    inserted: [],
    visits: 0,
    trips: 0,
    events: 0,
    locationRecords: 0,
    rejects: [],
  };
  for (const record of payload.locations) {
    const single = prepareBatch({ locations: [record] }, receivedAt);
    try {
      const result = await tx.transaction((savepoint) =>
        insertPreparedRecords(savepoint, deviceId, single),
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
        record: deadLetterRecord(record),
      });
    }
  }
  stored.inserted.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  return stored;
}
