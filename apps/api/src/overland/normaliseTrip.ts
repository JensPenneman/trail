import { type BatteryReading, batteryReading } from "./batteryReading";
import { type Normalised, rejected } from "./normalised";
import { asRecord, extraOf, nonNegativeOrNull } from "./overlandValues";
import { parseOverlandTimestamp } from "./parseOverlandTimestamp";
import { recordTime } from "./recordTime";

export interface NormalisedTrip {
  startedAt: Date;
  endedAt: Date;
  mode: string;
  distanceM: number | null;
  durationS: number | null;
  steps: number | null;
  stoppedAutomatically: boolean;
  startLocation: unknown;
  endLocation: unknown;
  extra: Record<string, unknown> | null;
  battery: BatteryReading | null;
}

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
  const end =
    parseOverlandTimestamp(properties["end"]) ?? parseOverlandTimestamp(properties["timestamp"]);
  if (end === null) return rejected("trip end: missing or invalid timestamp");
  if (end.getTime() < start.value.getTime()) return rejected("trip ends before it starts");

  const steps = nonNegativeOrNull(properties["steps"]);
  const extra = extraOf(properties, mapped);
  return {
    ok: true,
    value: {
      startedAt: start.value,
      endedAt: end,
      mode: typeof properties["mode"] === "string" ? properties["mode"] : "unknown",
      distanceM: nonNegativeOrNull(properties["distance"]),
      durationS: nonNegativeOrNull(properties["duration"]),
      steps: steps === null ? null : Math.round(steps),
      stoppedAutomatically: properties["stopped_automatically"] === true,
      startLocation: properties["start_location"] ?? null,
      endLocation: properties["end_location"] ?? null,
      // The trip's own point is its end position; keep it rather than drop it.
      extra:
        feature["geometry"] === undefined ? extra : { ...extra, geometry: feature["geometry"] },
      battery: batteryReading(properties, end),
    },
  };
}
