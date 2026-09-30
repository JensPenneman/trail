import type { Executor } from "../db/database";
import { insertEvents } from "./insertEvents";
import { insertLocations } from "./insertLocations";
import { insertTrips } from "./insertTrips";
import { insertVisits } from "./insertVisits";
import type { PreparedBatch } from "./prepareBatch";
import type { StoredRecords } from "./storedRecords";

/** Stores the records of a prepared batch with one statement per record kind. */
export async function insertPreparedRecords(
  tx: Executor,
  deviceId: string,
  batch: PreparedBatch,
): Promise<StoredRecords> {
  const inserted = await insertLocations(tx, deviceId, batch.locations);
  const visits = await insertVisits(tx, deviceId, batch.visits);
  const trips = await insertTrips(tx, deviceId, batch.trips);
  const events = await insertEvents(tx, deviceId, batch.events);
  return {
    inserted,
    visits,
    trips,
    events,
    locationRecords: batch.locationRecords,
    rejects: batch.rejects,
  };
}
