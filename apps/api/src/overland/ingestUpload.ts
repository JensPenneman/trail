import { eq } from "drizzle-orm";
import type { Database } from "../db/database";
import { devices } from "../db/schema/devices";
import { ingestLog } from "../db/schema/ingestLog";
import type { IngestDevice } from "./ingestDevice";
import { insertEvents } from "./insertEvents";
import { type InsertedPoint, insertLocations } from "./insertLocations";
import { insertRejects } from "./insertRejects";
import { insertTrips } from "./insertTrips";
import { insertVisits } from "./insertVisits";
import type { OverlandPayload } from "./overlandPayload";
import { prepareBatch } from "./prepareBatch";
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

/**
 * Stores one Overland upload in a single transaction (docs/architecture.md
 * §6.2). The device row is locked first, so concurrent uploads of one phone
 * cannot interleave their cache updates. Null = the device vanished meanwhile.
 */
export async function ingestUpload(
  db: Database,
  device: IngestDevice,
  payload: OverlandPayload,
  userAgent: string | null,
): Promise<IngestOutcome | null> {
  const started = performance.now();
  const receivedAt = new Date();
  const batch = prepareBatch(payload, receivedAt);

  return db.transaction(async (tx) => {
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

    const inserted = await insertLocations(tx, device.id, batch.locations);
    const visits = await insertVisits(tx, device.id, batch.visits);
    const trips = await insertTrips(tx, device.id, batch.trips);
    const events = await insertEvents(tx, device.id, batch.events);
    await insertRejects(tx, device.id, batch.rejects, receivedAt);
    await updateDeviceAfterIngest(tx, {
      deviceId: device.id,
      state,
      batch,
      inserted: inserted.length,
      receivedAt,
    });

    const counts: IngestCounts = {
      records: batch.records,
      locations: inserted.length,
      duplicates: batch.locationRecords - inserted.length,
      visits,
      trips,
      events,
      rejected: batch.rejects.length,
    };
    await tx.insert(ingestLog).values({
      deviceId: device.id,
      receivedAt,
      ...counts,
      durationMs: Math.round(performance.now() - started),
      userAgent,
    });
    return {
      receivedAt,
      counts,
      inserted,
      pendingSettings: state.pendingSettings,
      wasSilent: state.staleAlertedAt !== null,
    };
  });
}
