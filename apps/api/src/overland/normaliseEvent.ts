import { type BatteryReading, batteryReading } from "./batteryReading";
import { type Normalised, rejected } from "./normalised";
import { asRecord, extraOf } from "./overlandValues";
import { parsePointGeometry } from "./parsePointGeometry";
import { recordTime } from "./recordTime";

export interface NormalisedEvent {
  recordedAt: Date;
  action: string;
  lat: number | null;
  lon: number | null;
  extra: Record<string, unknown> | null;
  battery: BatteryReading | null;
}

const mapped = new Set(["action", "timestamp"]);

/**
 * An app/tracking log action ("paused_location_updates", "did_enter_background",
 * …). Geometry is optional; an unusable one is kept in `extra` instead.
 */
export function normaliseEvent(record: unknown, receivedAt: Date): Normalised<NormalisedEvent> {
  const feature = asRecord(record);
  if (feature === null) return rejected("record is not an object");
  const properties = asRecord(feature["properties"]);
  if (properties === null) return rejected("missing properties");
  const action = properties["action"];
  if (typeof action !== "string" || action.trim() === "") return rejected("missing action");
  const time = recordTime(properties["timestamp"], receivedAt);
  if (!time.ok) return rejected(time.reason);

  const rawGeometry = feature["geometry"];
  const geometry =
    rawGeometry === undefined || rawGeometry === null ? null : parsePointGeometry(rawGeometry);
  const extra = extraOf(properties, mapped);
  return {
    ok: true,
    value: {
      recordedAt: time.value,
      action,
      lat: geometry?.ok === true ? geometry.lat : null,
      lon: geometry?.ok === true ? geometry.lon : null,
      extra: geometry !== null && !geometry.ok ? { ...extra, geometry: rawGeometry } : extra,
      battery: batteryReading(properties, time.value),
    },
  };
}
