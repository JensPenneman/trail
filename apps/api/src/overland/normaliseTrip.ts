import { batteryReading } from "../ingest/batteryReading";
import {
  asRecord,
  countOrNull,
  extraOf,
  nonNegativeOrNull,
  textOrNull,
} from "../ingest/ingestValues";
import { type Normalised, rejected } from "../ingest/normalised";
import type { NormalisedTrip } from "../ingest/normalisedRecords";
import { parseIsoTimestamp } from "../ingest/parseIsoTimestamp";
import { recordTime } from "../ingest/recordTime";
import { storableJson } from "../ingest/storableJson";

const mapped = new Set([
  "type",
  "mode",
  "start",
  "end",
  "distance",
  "duration",
  "steps",
  "stopped_automatically",
  "start_location",
  "end_location",
]);

/** A finished trip (`properties.type === "trip"`), keyed by its start. */
export function normaliseTrip(record: unknown, receivedAt: Date): Normalised<NormalisedTrip> {
  const feature = asRecord(record);
  if (feature === null) return rejected("record is not an object");
  const properties = asRecord(feature["properties"]);
  if (properties === null) return rejected("missing properties");

  const start = recordTime(properties["start"], receivedAt);
  if (!start.ok) return rejected(`trip start: ${start.reason}`);
  const end = parseIsoTimestamp(properties["end"]) ?? parseIsoTimestamp(properties["timestamp"]);
  if (end === null) return rejected("trip end: missing or invalid timestamp");
  if (end.getTime() < start.value.getTime()) return rejected("trip ends before it starts");

  const extra = extraOf(properties, mapped);
  return {
    ok: true,
    value: {
      startedAt: start.value,
      endedAt: end,
      mode: textOrNull(properties["mode"]) ?? "unknown",
      distanceM: nonNegativeOrNull(properties["distance"]),
      durationS: nonNegativeOrNull(properties["duration"]),
      steps: countOrNull(properties["steps"]),
      stoppedAutomatically: properties["stopped_automatically"] === true,
      startLocation: storableJson(properties["start_location"] ?? null),
      endLocation: storableJson(properties["end_location"] ?? null),
      // The trip's own point is its end position; keep it rather than drop it.
      extra:
        feature["geometry"] === undefined
          ? extra
          : { ...extra, geometry: storableJson(feature["geometry"], 1) },
      battery: batteryReading(properties, end),
    },
  };
}
