import { batteryReading } from "../ingest/batteryReading";
import {
  asRecord,
  batteryLevelOf,
  batteryStateOf,
  extraOf,
  nonNegativeRealOrNull,
  realOrNull,
  stringArrayOf,
  wifiOf,
} from "../ingest/ingestValues";
import { type Normalised, rejected } from "../ingest/normalised";
import type { NormalisedLocation } from "../ingest/normalisedRecords";
import { recordTime } from "../ingest/recordTime";
import { parsePointGeometry } from "./parsePointGeometry";

/** Properties stored in their own columns; the rest (tracking stats, unique_id, …) goes to `extra`. */
const mapped = new Set([
  "timestamp",
  "altitude",
  "speed",
  "course",
  "horizontal_accuracy",
  "vertical_accuracy",
  "speed_accuracy",
  "course_accuracy",
  "motion",
  "battery_level",
  "battery_state",
  "wifi",
]);

/** A location point (also used for the payload's `current`). */
export function normaliseLocation(
  record: unknown,
  receivedAt: Date,
): Normalised<NormalisedLocation> {
  const feature = asRecord(record);
  if (feature === null) return rejected("record is not an object");
  const properties = asRecord(feature["properties"]);
  if (properties === null) return rejected("missing properties");
  const geometry = parsePointGeometry(feature["geometry"]);
  if (!geometry.ok) return rejected(geometry.reason);
  const time = recordTime(properties["timestamp"], receivedAt);
  if (!time.ok) return rejected(time.reason);

  // A negative vertical accuracy means the altitude itself is invalid.
  const rawVertical = realOrNull(properties["vertical_accuracy"]);
  const altitudeValid = rawVertical === null || rawVertical >= 0;

  return {
    ok: true,
    value: {
      recordedAt: time.value,
      lat: geometry.lat,
      lon: geometry.lon,
      altitude: altitudeValid ? realOrNull(properties["altitude"]) : null,
      speed: nonNegativeRealOrNull(properties["speed"]),
      course: nonNegativeRealOrNull(properties["course"]),
      horizontalAccuracy: nonNegativeRealOrNull(properties["horizontal_accuracy"]),
      verticalAccuracy: altitudeValid ? rawVertical : null,
      speedAccuracy: nonNegativeRealOrNull(properties["speed_accuracy"]),
      courseAccuracy: nonNegativeRealOrNull(properties["course_accuracy"]),
      motion: stringArrayOf(properties["motion"]),
      batteryLevel: batteryLevelOf(properties["battery_level"]),
      batteryState: batteryStateOf(properties["battery_state"]),
      wifi: wifiOf(properties["wifi"]),
      extra: extraOf(properties, mapped),
      battery: batteryReading(properties, time.value),
    },
  };
}
