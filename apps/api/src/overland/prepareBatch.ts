import { deadLetterRecord } from "../ingest/deadLetterRecord";
import type {
  NormalisedEvent,
  NormalisedLocation,
  NormalisedTrip,
  NormalisedVisit,
} from "../ingest/normalisedRecords";
import { newerBattery, type PreparedBatch, type RejectedRecord } from "../ingest/preparedBatch";
import { classifyRecord } from "./classifyRecord";
import { normaliseEvent } from "./normaliseEvent";
import { normaliseLiveTrip } from "./normaliseLiveTrip";
import { normaliseLocation } from "./normaliseLocation";
import { normaliseTrip } from "./normaliseTrip";
import { normaliseVisit } from "./normaliseVisit";
import type { OverlandPayload } from "./overlandPayload";

/** An Overland upload split into what will be stored (docs/architecture.md §6.4). */
export function prepareBatch(payload: OverlandPayload, receivedAt: Date): PreparedBatch {
  const locations = new Map<number, NormalisedLocation>();
  const visits = new Map<number, NormalisedVisit>();
  const trips = new Map<number, NormalisedTrip>();
  const events = new Map<string, NormalisedEvent>();
  const rejects: RejectedRecord[] = [];
  let locationRecords = 0;
  let battery: PreparedBatch["battery"] = null;

  const noteBattery = (reading: PreparedBatch["battery"]) => {
    battery = newerBattery(battery, reading);
  };
  const reject = (reason: string, record: unknown) => {
    rejects.push({ reason, record: deadLetterRecord(record) });
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
    liveTrip: normaliseLiveTrip(payload.trip, receivedAt),
    battery,
  };
}
