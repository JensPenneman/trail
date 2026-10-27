import { batteryReading } from "../ingest/batteryReading";
import { asRecord, extraOf, textOrNull } from "../ingest/ingestValues";
import { type Normalised, rejected } from "../ingest/normalised";
import type { NormalisedEvent } from "../ingest/normalisedRecords";
import { recordTime } from "../ingest/recordTime";
import { storableJson } from "../ingest/storableJson";
import { parsePointGeometry } from "./parsePointGeometry";

const mapped = new Set(["action", "timestamp"]);

/* Overland's actions are short identifiers; the action is part of the table's
 * primary key, whose index cannot hold values of kilobytes. */
const maxActionLength = 100;

/**
 * An app/tracking log action ("paused_location_updates", "did_enter_background",
 * …). Geometry is optional; an unusable one is kept in `extra` instead.
 */
export function normaliseEvent(record: unknown, receivedAt: Date): Normalised<NormalisedEvent> {
  const feature = asRecord(record);
  if (feature === null) return rejected("record is not an object");
  const properties = asRecord(feature["properties"]);
  if (properties === null) return rejected("missing properties");
  const action = textOrNull(properties["action"]);
  if (action === null) return rejected("missing action");
  if (action.length > maxActionLength) return rejected("action is too long");
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
      extra:
        geometry !== null && !geometry.ok
          ? { ...extra, geometry: storableJson(rawGeometry, 1) }
          : extra,
      battery: batteryReading(properties, time.value),
    },
  };
}
