import type { InsertedPoint } from "./insertLocations";
import type { InsertedTrip } from "./insertTrips";
import type { InsertedVisit } from "./insertVisits";
import type { RejectedRecord } from "./preparedBatch";

/** What storing an upload's records produced, whichever way they were stored. */
export interface StoredRecords {
  /** Newly stored points, oldest first. */
  inserted: InsertedPoint[];
  /** Newly stored visits and trips. */
  visits: InsertedVisit[];
  trips: InsertedTrip[];
  events: number;
  /** Valid location records, including repeats (the duplicate count is this minus `inserted`). */
  locationRecords: number;
  /** For the dead letter. */
  rejects: RejectedRecord[];
}
