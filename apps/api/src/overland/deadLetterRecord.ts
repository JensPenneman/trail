import { storableJson } from "./storableJson";
import { storableText } from "./storableText";

/* A dead-letter row keeps the record for inspection, not an arbitrarily large blob. */
const maxRejectBytes = 16_384;

/**
 * A rejected record as `ingest_rejects` can store it: made storable (see
 * storableJson), and kept as a 2 000-character preview when it is large.
 */
export function deadLetterRecord(record: unknown): unknown {
  const storable = storableJson(record);
  const json = JSON.stringify(storable) ?? "null";
  return json.length <= maxRejectBytes
    ? storable
    : { truncated: true, preview: storableText(json.slice(0, 2000)) };
}
