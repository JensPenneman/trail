import { type BatteryReading, batteryReading } from "./batteryReading";
import { type Normalised, rejected } from "./normalised";
import {
  asRecord,
  type BatteryState,
  batteryLevelOf,
  batteryStateOf,
  extraOf,
  finiteOrNull,
  nonNegativeOrNull,
  stringArrayOf,
  wifiOf,
} from "./overlandValues";
import { parsePointGeometry } from "./parsePointGeometry";
import { recordTime } from "./recordTime";

export interface NormalisedLocation {
  recordedAt: Date;
  lat: number;
  lon: number;
  altitude: number | null;
  speed: number | null;
  course: number | null;
  horizontalAccuracy: number | null;
  verticalAccuracy: number | null;
  speedAccuracy: number | null;
  courseAccuracy: number | null;
  motion: string[];
  batteryLevel: number | null;
  batteryState: BatteryState | null;
  wifi: string | null;
  extra: Record<string, unknown> | null;
  battery: BatteryReading | null;
}

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
  const rawVertical = finiteOrNull(properties["vertical_accuracy"]);
  const altitudeValid = rawVertical === null || rawVertical >= 0;

  return {
    ok: true,
    value: {
      recordedAt: time.value,
      lat: geometry.lat,
      lon: geometry.lon,
      altitude: altitudeValid ? finiteOrNull(properties["altitude"]) : null,
      speed: nonNegativeOrNull(properties["speed"]),
      course: nonNegativeOrNull(properties["course"]),
      horizontalAccuracy: nonNegativeOrNull(properties["horizontal_accuracy"]),
      verticalAccuracy: altitudeValid ? rawVertical : null,
      speedAccuracy: nonNegativeOrNull(properties["speed_accuracy"]),
      courseAccuracy: nonNegativeOrNull(properties["course_accuracy"]),
      motion: stringArrayOf(properties["motion"]),
      batteryLevel: batteryLevelOf(properties["battery_level"]),
      batteryState: batteryStateOf(properties["battery_state"]),
      wifi: wifiOf(properties["wifi"]),
      extra: extraOf(properties, mapped),
      battery: batteryReading(properties, time.value),
    },
  };
}
