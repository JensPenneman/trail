import { deadLetterRecord } from "../ingest/deadLetterRecord";
import { asRecord } from "../ingest/ingestValues";
import type { NormalisedEvent, NormalisedLocation } from "../ingest/normalisedRecords";
import {
  emptyBatch,
  newerBattery,
  type PreparedBatch,
  type RejectedRecord,
} from "../ingest/preparedBatch";
import { withoutSecrets } from "../ingest/withoutSecrets";
import { normaliseOsmandPoint, storableParameters } from "./normaliseOsmandPoint";
import { normaliseTraccarLocation } from "./normaliseTraccarJson";
import type { OsmandApp } from "./osmandApps";
import type { OsmandRequest } from "./osmandRequest";

/** An OsmAnd-format upload prepared for storing: the batch, and every record as the dead letter keeps it. */
export interface PreparedOsmand {
  batch: PreparedBatch;
  /** One per record, for the fallback after a refused value. */
  singles: { record: unknown; batch: PreparedBatch }[];
}

/* Traccar Client 9 sends one location per request (it leaves the plugin's
 * `batchSync` off); an array, as the plugin sends with it on, is read too. 64 kB
 * hold about 130 locations as the plugin writes them: more entries than this
 * are no client's, and one record of the dead letter rather than thousands. */
const maxJsonLocations = 1000;

const rejectedAs = (reason: string, record: unknown): PreparedOsmand => {
  const kept = deadLetterRecord(withoutSecrets(record));
  const batch: PreparedBatch = { ...emptyBatch(1), rejects: [{ reason, record: kept }] };
  return { batch, singles: [{ record: kept, batch }] };
};

/** The batch of one record's outcome. */
function batchOf(result: ReturnType<typeof normaliseOsmandPoint>, record: unknown): PreparedBatch {
  if (!result.ok) {
    return {
      ...emptyBatch(1),
      rejects: [{ reason: result.reason, record: deadLetterRecord(record) }],
    };
  }
  const { location, events, battery } = result.value;
  return {
    ...emptyBatch(1),
    locationRecords: location === null ? 0 : 1,
    locations: location === null ? [] : [location],
    events,
    battery,
  };
}

/** Several records' batches as one: points unique by time, oldest first, like Overland's. */
function merged(batches: readonly PreparedBatch[]): PreparedBatch {
  const locations = new Map<number, NormalisedLocation>();
  const events = new Map<string, NormalisedEvent>();
  const rejects: RejectedRecord[] = [];
  let battery: PreparedBatch["battery"] = null;
  let locationRecords = 0;
  for (const batch of batches) {
    locationRecords += batch.locationRecords;
    for (const location of batch.locations) {
      const key = location.recordedAt.getTime();
      if (!locations.has(key)) locations.set(key, location);
    }
    for (const event of batch.events)
      events.set(`${event.recordedAt.getTime()}|${event.action}`, event);
    rejects.push(...batch.rejects);
    battery = newerBattery(battery, batch.battery);
  }
  return {
    ...emptyBatch(batches.length),
    locationRecords,
    locations: [...locations.values()].sort(
      (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
    ),
    events: [...events.values()],
    rejects,
    battery,
  };
}

/**
 * One request in the OsmAnd format (docs/architecture.md §6.6): the query or
 * form parameters as one point with the units of the device's app, or a
 * Traccar Client 9 JSON body with its locations. Whatever cannot be read is
 * kept in the dead letter — never the token — and still acknowledged: Traccar
 * Client sends its queue in order and retries the first upload until it is
 * taken.
 */
export function prepareOsmand(
  request: OsmandRequest,
  app: OsmandApp,
  receivedAt: Date,
): PreparedOsmand {
  if (request.json !== null) {
    if (!request.json.ok) return rejectedAs("body is not JSON", { body: request.json.preview });
    const root = asRecord(request.json.value);
    if (root === null) return rejectedAs("body is not a JSON object", request.json.value);
    const location = root["location"];
    if (location === undefined || location === null) return rejectedAs("missing location", root);
    const entries: unknown[] = Array.isArray(location) ? location : [location];
    if (entries.length > maxJsonLocations) return rejectedAs("too many locations", root);
    const singles = entries.map((entry) => {
      const record = withoutSecrets(entry);
      return { record, batch: batchOf(normaliseTraccarLocation(entry, receivedAt), record) };
    });
    return { batch: merged(singles.map((single) => single.batch)), singles };
  }
  const record = storableParameters(request.params);
  if (request.overflow) return rejectedAs("too many parameters", record);
  const batch = batchOf(normaliseOsmandPoint(request.params, app, receivedAt), record);
  return { batch, singles: [{ record, batch }] };
}
