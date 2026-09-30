import { eq } from "drizzle-orm";
import type { Database, Transaction } from "../db/database";
import { refusedDataCode } from "../db/refusedDataCode";
import { devices } from "../db/schema/devices";
import { ingestLog } from "../db/schema/ingestLog";
import type { IngestDevice } from "./ingestDevice";
import type { InsertedPoint } from "./insertLocations";
import { insertPreparedRecords } from "./insertPreparedRecords";
import { insertRecordByRecord } from "./insertRecordByRecord";
import { insertRejects } from "./insertRejects";
import type { OverlandPayload } from "./overlandPayload";
import { type PreparedBatch, prepareBatch } from "./prepareBatch";
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
  /** Preset to send back once as `set`. */
  pendingSettings: string | null;
  /** The device had been reported silent: send the "sending data again" alert. */
  wasSilent: boolean;
}

interface Upload {
  device: IngestDevice;
  batch: PreparedBatch;
  receivedAt: Date;
  userAgent: string | null;
  started: number;
}

/**
 * Stores one Overland upload in a single transaction (docs/architecture.md
 * §6.2). The device row is locked first, so concurrent uploads of one phone
 * cannot interleave their cache updates. Should Postgres refuse a value the
 * normalisation let through, the upload is stored again record by record and
 * the refused records go to the dead letter (§6.1). Null = the device vanished.
 */
export async function ingestUpload(
  db: Database,
  device: IngestDevice,
  payload: OverlandPayload,
  userAgent: string | null,
): Promise<IngestOutcome | null> {
  const started = performance.now();
  const receivedAt = new Date();
  const upload: Upload = {
    device,
    batch: prepareBatch(payload, receivedAt),
    receivedAt,
    userAgent,
    started,
  };
  try {
    return await db.transaction((tx) =>
      storeUpload(tx, upload, () => insertPreparedRecords(tx, device.id, upload.batch)),
    );
  } catch (error) {
    if (refusedDataCode(error) === null) throw error;
    return db.transaction((tx) =>
      storeUpload(tx, upload, () => insertRecordByRecord(tx, device.id, payload, receivedAt), {
        isolated: true,
      }),
    );
  }
}

async function storeUpload(
  tx: Transaction,
  upload: Upload,
  insertRecords: () => Promise<StoredRecords>,
  options: { isolated: boolean } = { isolated: false },
): Promise<IngestOutcome | null> {
  const { device, batch, receivedAt } = upload;
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
  };
  if (options.isolated) await updateDeviceCarefully(tx, update);
  else await updateDeviceAfterIngest(tx, update);

  const counts: IngestCounts = {
    records: batch.records,
    locations: stored.inserted.length,
    duplicates: stored.locationRecords - stored.inserted.length,
    visits: stored.visits,
    trips: stored.trips,
    events: stored.events,
    rejected: stored.rejects.length,
  };
  await tx.insert(ingestLog).values({
    deviceId: device.id,
    receivedAt,
    ...counts,
    durationMs: Math.round(performance.now() - upload.started),
    userAgent: upload.userAgent,
  });
  return {
    receivedAt,
    counts,
    inserted: stored.inserted,
    pendingSettings: state.pendingSettings,
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
