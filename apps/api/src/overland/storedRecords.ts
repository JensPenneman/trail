import type { InsertedPoint } from "./insertLocations";
import type { RejectedRecord } from "./prepareBatch";

/** What storing an upload's records produced, whichever way they were stored. */
export interface StoredRecords {
  /** Newly stored points, oldest first. */
  inserted: InsertedPoint[];
  visits: number;
  trips: number;
  events: number;
  /** Valid location records, including repeats (the duplicate count is this minus `inserted`). */
  locationRecords: number;
  /** For the dead letter. */
  rejects: RejectedRecord[];
}
