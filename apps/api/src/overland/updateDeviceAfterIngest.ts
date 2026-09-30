import { eq, sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { devices } from "../db/schema/devices";
import type { NormalisedLocation } from "./normaliseLocation";
import type { PreparedBatch } from "./prepareBatch";

/** Cached device state read (and row-locked) at the start of the ingest transaction. */
export interface DeviceIngestState {
  lastRecordedAt: Date | null;
  batteryRecordedAt: Date | null;
  pendingSettings: string | null;
}

const newest = (
  a: NormalisedLocation | undefined,
  b: NormalisedLocation | null,
): NormalisedLocation | null => {
  if (a === undefined) return b;
  if (b === null) return a;
  return b.recordedAt > a.recordedAt ? b : a;
};

/**
 * Step 2 of docs/architecture.md §6.2: last upload time, point counter, the
 * cached position (newest stored point or `current`, only if newer than the
 * cache), battery, the live trip, and a queued settings preset marked applied.
 */
export async function updateDeviceAfterIngest(
  tx: Executor,
  input: {
    deviceId: string;
    state: DeviceIngestState;
    batch: PreparedBatch;
    inserted: number;
    receivedAt: Date;
  },
): Promise<void> {
  const { state, batch, receivedAt } = input;
  const position = newest(batch.locations.at(-1), batch.current);
  const positionIsNewer =
    position !== null &&
    (state.lastRecordedAt === null || position.recordedAt > state.lastRecordedAt);
  const { battery } = batch;
  const batteryIsNewer =
    battery !== null &&
    (state.batteryRecordedAt === null || battery.recordedAt > state.batteryRecordedAt);

  await tx
    .update(devices)
    .set({
      lastSeenAt: receivedAt,
      pointsTotal: sql`${devices.pointsTotal} + ${input.inserted}`,
      liveTrip: batch.liveTrip,
      staleAlertedAt: null,
      ...(positionIsNewer
        ? {
            lastRecordedAt: position.recordedAt,
            lastLat: position.lat,
            lastLon: position.lon,
            lastAccuracy: position.horizontalAccuracy,
            lastSpeed: position.speed,
            lastAltitude: position.altitude,
            lastCourse: position.course,
            lastMotion: position.motion,
          }
        : {}),
      ...(batteryIsNewer
        ? {
            batteryLevel: battery.level,
            batteryState: battery.state,
            batteryRecordedAt: battery.recordedAt,
          }
        : {}),
      ...(state.pendingSettings === null
        ? {}
        : { pendingSettings: null, settingsAppliedAt: receivedAt }),
    })
    .where(eq(devices.id, input.deviceId));
}
