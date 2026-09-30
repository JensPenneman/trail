import type { StoredLiveTrip } from "../db/schema/devices";
import type { BatteryReading } from "./batteryReading";
import { classifyRecord } from "./classifyRecord";
import { type NormalisedEvent, normaliseEvent } from "./normaliseEvent";
import { normaliseLiveTrip } from "./normaliseLiveTrip";
import { type NormalisedLocation, normaliseLocation } from "./normaliseLocation";
import { type NormalisedTrip, normaliseTrip } from "./normaliseTrip";
import { type NormalisedVisit, normaliseVisit } from "./normaliseVisit";
import type { OverlandPayload } from "./overlandPayload";

export interface RejectedRecord {
  reason: string;
  record: unknown;
}

/** An upload split into what will be stored, before touching the database. */
export interface PreparedBatch {
  /** Entries in the payload's `locations` array. */
  records: number;
  /** Valid location records, including repeats within this batch (for the duplicate count). */
  locationRecords: number;
  /** Unique by timestamp, oldest first. */
  locations: NormalisedLocation[];
  visits: NormalisedVisit[];
  trips: NormalisedTrip[];
  events: NormalisedEvent[];
  rejects: RejectedRecord[];
  /** The payload's `current` position (cached on the device, not stored as a point). */
  current: NormalisedLocation | null;
  liveTrip: StoredLiveTrip | null;
  /** Newest battery reading of any record. */
  battery: BatteryReading | null;
}

/* A dead-letter row keeps the record for inspection, not an arbitrarily large blob. */
const maxRejectBytes = 16_384;

const cappedRecord = (record: unknown): unknown => {
  const json = JSON.stringify(record) ?? "null";
  return json.length <= maxRejectBytes ? record : { truncated: true, preview: json.slice(0, 2000) };
};

export function prepareBatch(payload: OverlandPayload, receivedAt: Date): PreparedBatch {
  const locations = new Map<number, NormalisedLocation>();
  const visits = new Map<number, NormalisedVisit>();
  const trips = new Map<number, NormalisedTrip>();
  const events = new Map<string, NormalisedEvent>();
  const rejects: RejectedRecord[] = [];
  let locationRecords = 0;
  let battery: BatteryReading | null = null;

  const noteBattery = (reading: BatteryReading | null) => {
    if (reading !== null && (battery === null || reading.recordedAt > battery.recordedAt)) {
      battery = reading;
    }
  };
  const reject = (reason: string, record: unknown) => {
    rejects.push({ reason, record: cappedRecord(record) });
  };

  for (const record of payload.locations) {
    switch (classifyRecord(record)) {
      case "visit": {
        const result = normaliseVisit(record, receivedAt);
        if (!result.ok) reject(result.reason, record);
        else {
          visits.set(result.value.recordedAt.getTime(), result.value);
          noteBattery(result.value.battery);
        }
        break;
      }
      case "trip": {
        const result = normaliseTrip(record, receivedAt);
        if (!result.ok) reject(result.reason, record);
        else {
          trips.set(result.value.startedAt.getTime(), result.value);
          noteBattery(result.value.battery);
        }
        break;
      }
      case "event": {
        const result = normaliseEvent(record, receivedAt);
        if (!result.ok) reject(result.reason, record);
        else {
          events.set(`${result.value.recordedAt.getTime()}|${result.value.action}`, result.value);
          noteBattery(result.value.battery);
        }
        break;
      }
      case "location": {
        const result = normaliseLocation(record, receivedAt);
        if (!result.ok) reject(result.reason, record);
        else {
          locationRecords += 1;
          const key = result.value.recordedAt.getTime();
          // At most one point per second: the first one of a timestamp wins, as in the database.
          if (!locations.has(key)) locations.set(key, result.value);
          noteBattery(result.value.battery);
        }
        break;
      }
    }
  }

  const currentResult =
    payload.current === undefined || payload.current === null
      ? null
      : normaliseLocation(payload.current, receivedAt);
  const current = currentResult?.ok === true ? currentResult.value : null;
  if (current !== null) noteBattery(current.battery);

  return {
    records: payload.locations.length,
    locationRecords,
    locations: [...locations.values()].sort(
      (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
    ),
    visits: [...visits.values()],
    trips: [...trips.values()],
    events: [...events.values()],
    rejects,
    current,
    liveTrip: normaliseLiveTrip(payload.trip),
    battery,
  };
}
