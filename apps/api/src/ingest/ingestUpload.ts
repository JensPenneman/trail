import { eq } from "drizzle-orm";
import type { Database, Transaction } from "../db/database";
import { refusedDataCode } from "../db/refusedDataCode";
import { devices } from "../db/schema/devices";
import { ingestLog } from "../db/schema/ingestLog";
import type { IngestDevice } from "./ingestDevice";
import type { InsertedPoint } from "./insertLocations";
import { insertPreparedRecords } from "./insertPreparedRecords";
import { insertRecordByRecord, type SingleRecord } from "./insertRecordByRecord";
import { insertRejects } from "./insertRejects";
import type { InsertedTrip } from "./insertTrips";
import type { InsertedVisit } from "./insertVisits";
import type { PreparedBatch } from "./preparedBatch";
import type { StoredRecords } from "./storedRecords";
import { updateDeviceAfterIngest } from "./updateDeviceAfterIngest";

interface IngestCounts {
  records: number;
  locations: number;
  duplicates: number;
  visits: number;
  trips: number;
  events: number;
  rejected: number;
}

export interface IngestOutcome {
  receivedAt: Date;
  counts: IngestCounts;
  /** Newly stored points, oldest first. */
  inserted: InsertedPoint[];
  /** Newly stored visits and trips: their days' stamps changed too. */
  visits: InsertedVisit[];
  trips: InsertedTrip[];
  /** Preset to send back once as Overland's `set` (always null for the other apps). */
  pendingSettings: string | null;
  /** The device had been reported silent: send the "sending data again" alert. */
  wasSilent: boolean;
}

/** One upload as a protocol's router prepared it. */
export interface Upload {
  batch: PreparedBatch;
  /** The upload's records prepared one by one, for the fallback after a refused value. */
  singles: () => readonly SingleRecord[];
  /** When the upload arrived: the timestamps were checked against it. */
  receivedAt: Date;
  /** `performance.now()` when the request arrived, for the log's duration. */
  started: number;
  userAgent: string | null;
  /** Overland takes settings presets in its answer; no other app does. */
  deliversSettings: boolean;
}

/**
 * Stores one upload in a single transaction (docs/architecture.md §6.2),
 * whichever app sent it. The device row is locked first, so concurrent
 * uploads of one phone cannot interleave their cache updates. Should Postgres
 * refuse a value the normalisation let through, the upload is stored again
 * record by record and the refused records go to the dead letter (§6.1).
 * Null = the device vanished.
 */
export async function ingestUpload(
  db: Database,
  device: IngestDevice,
  upload: Upload,
): Promise<IngestOutcome | null> {
  try {
    return await db.transaction((tx) =>
      storeUpload(tx, device, upload, () => insertPreparedRecords(tx, device.id, upload.batch)),
    );
  } catch (error) {
    if (refusedDataCode(error) === null) throw error;
    return db.transaction((tx) =>
      storeUpload(tx, device, upload, () => insertRecordByRecord(tx, device.id, upload.singles()), {
        isolated: true,
      }),
    );
  }
}

async function storeUpload(
  tx: Transaction,
  device: IngestDevice,
  upload: Upload,
  insertRecords: () => Promise<StoredRecords>,
  options: { isolated: boolean } = { isolated: false },
): Promise<IngestOutcome | null> {
  const { batch, receivedAt, deliversSettings } = upload;
  const [state] = await tx
    .select({
      lastRecordedAt: devices.lastRecordedAt,
      batteryRecordedAt: devices.batteryRecordedAt,
      pendingSettings: devices.pendingSettings,
      staleAlertedAt: devices.staleAlertedAt,
    })
    .from(devices)
    .where(eq(devices.id, device.id))
    .for("update");
  if (state === undefined) return null;

  const stored = await insertRecords();
  await insertRejects(tx, device.id, stored.rejects, receivedAt);
  const update = {
    deviceId: device.id,
    state,
    batch,
    inserted: stored.inserted.length,
    receivedAt,
    deliversSettings,
  };
  if (options.isolated) await updateDeviceCarefully(tx, update);
  else await updateDeviceAfterIngest(tx, update);

  const counts: IngestCounts = {
    records: batch.records,
    locations: stored.inserted.length,
    duplicates: stored.locationRecords - stored.inserted.length,
    visits: stored.visits.length,
    trips: stored.trips.length,
    events: stored.events,
    rejected: stored.rejects.length,
  };
  await tx.insert(ingestLog).values({
    deviceId: device.id,
    receivedAt,
    source: device.app,
    ...counts,
    durationMs: Math.round(performance.now() - upload.started),
    userAgent: upload.userAgent,
  });
  return {
    receivedAt,
    counts,
    inserted: stored.inserted,
    visits: stored.visits,
    trips: stored.trips,
    pendingSettings: deliversSettings ? state.pendingSettings : null,
    wasSilent: state.staleAlertedAt !== null,
  };
}

/**
 * The device update of an upload that already had a value refused: if the
 * newest readings (position, battery, live trip) are what Postgres refuses, the
 * upload is still recorded — without them.
 */
async function updateDeviceCarefully(
  tx: Transaction,
  update: Parameters<typeof updateDeviceAfterIngest>[1],
): Promise<void> {
  try {
    await tx.transaction((savepoint) => updateDeviceAfterIngest(savepoint, update));
  } catch (error) {
    if (refusedDataCode(error) === null) throw error;
    const withoutReadings: PreparedBatch = {
      ...update.batch,
      locations: [],
      current: null,
      battery: null,
      liveTrip: null,
    };
    await updateDeviceAfterIngest(tx, { ...update, batch: withoutReadings });
  }
}
