import type { StoredLiveTrip } from "../db/schema/devices";
import type { BatteryReading } from "./batteryReading";
import type {
  NormalisedEvent,
  NormalisedLocation,
  NormalisedTrip,
  NormalisedVisit,
} from "./normalisedRecords";

export interface RejectedRecord {
  reason: string;
  record: unknown;
}

/** An upload split into what will be stored, before touching the database. */
export interface PreparedBatch {
  /** Records in the upload: entries of Overland's `locations` array, one message for the other apps. */
  records: number;
  /** Valid location records, including repeats within this batch (for the duplicate count). */
  locationRecords: number;
  /** Unique by timestamp, oldest first. */
  locations: NormalisedLocation[];
  visits: NormalisedVisit[];
  trips: NormalisedTrip[];
  events: NormalisedEvent[];
  rejects: RejectedRecord[];
  /** Overland's `current` position (cached on the device, not stored as a point). */
  current: NormalisedLocation | null;
  /** Overland's trip in progress. */
  liveTrip: StoredLiveTrip | null;
  /** Newest battery reading of any record. */
  battery: BatteryReading | null;
}

/** The newer of two battery readings. */
export function newerBattery(
  current: BatteryReading | null,
  reading: BatteryReading | null,
): BatteryReading | null {
  if (reading === null) return current;
  if (current === null || reading.recordedAt > current.recordedAt) return reading;
  return current;
}

/** A batch with nothing in it but what the arguments give: the start of a one-message upload. */
export function emptyBatch(records: number): PreparedBatch {
  return {
    records,
    locationRecords: 0,
    locations: [],
    visits: [],
    trips: [],
    events: [],
    rejects: [],
    current: null,
    liveTrip: null,
    battery: null,
  };
}
