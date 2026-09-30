import { type BatteryReading, batteryReading } from "./batteryReading";
import { type Normalised, rejected } from "./normalised";
import { asRecord, extraOf, nonNegativeOrNull } from "./overlandValues";
import { parseOverlandTimestamp } from "./parseOverlandTimestamp";
import { parsePointGeometry } from "./parsePointGeometry";
import { recordTime } from "./recordTime";

export interface NormalisedVisit {
  recordedAt: Date;
  arrivedAt: Date | null;
  departedAt: Date | null;
  lat: number;
  lon: number;
  horizontalAccuracy: number | null;
  extra: Record<string, unknown> | null;
  battery: BatteryReading | null;
}

const mapped = new Set([
  "action",
  "timestamp",
  "arrival_date",
  "departure_date",
  "horizontal_accuracy",
]);

const yearMs = 366 * 86_400_000;

/*
 * iOS reports an unknown arrival as `distantPast` and an ongoing visit's
 * departure as `distantFuture`; Overland usually sends null for those, and any
 * such far-away date is treated the same way.
 */
const visitDate = (value: unknown, receivedAt: Date): Date | null => {
  const date = parseOverlandTimestamp(value);
  if (date === null) return null;
  if (date.getUTCFullYear() < 1990 || date.getTime() > receivedAt.getTime() + yearMs) return null;
  return date;
};

/** A CLVisit record (`properties.action === "visit"`). */
export function normaliseVisit(record: unknown, receivedAt: Date): Normalised<NormalisedVisit> {
  const feature = asRecord(record);
  if (feature === null) return rejected("record is not an object");
  const properties = asRecord(feature["properties"]);
  if (properties === null) return rejected("missing properties");
  const geometry = parsePointGeometry(feature["geometry"]);
  if (!geometry.ok) return rejected(geometry.reason);
  const time = recordTime(properties["timestamp"], receivedAt);
  if (!time.ok) return rejected(time.reason);
  return {
    ok: true,
    value: {
      recordedAt: time.value,
      arrivedAt: visitDate(properties["arrival_date"], receivedAt),
      departedAt: visitDate(properties["departure_date"], receivedAt),
      lat: geometry.lat,
      lon: geometry.lon,
      horizontalAccuracy: nonNegativeOrNull(properties["horizontal_accuracy"]),
      extra: extraOf(properties, mapped),
      battery: batteryReading(properties, time.value),
    },
  };
}
