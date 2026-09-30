import { asRecord } from "./overlandValues";

export type RecordKind = "location" | "visit" | "trip" | "event";

/**
 * What an entry of Overland's `locations` array is (docs/architecture.md §6):
 * visits have `action: "visit"`, trips `type: "trip"`, any other `action` is an
 * app/tracking log event; everything else is a location point.
 */
export function classifyRecord(record: unknown): RecordKind {
  const properties = asRecord(asRecord(record)?.["properties"]);
  if (properties === null) return "location";
  if (properties["action"] === "visit") return "visit";
  if (properties["type"] === "trip") return "trip";
  if (typeof properties["action"] === "string") return "event";
  return "location";
}
