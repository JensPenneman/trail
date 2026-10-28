import type { DayStamp } from "@trail/contracts/cacheStamp";
import type { SessionUser } from "@trail/contracts/user";

/**
 * What the store knows of an entry without reading its answer: one record of
 * the `entries` object store, small, so that the sweep and the warm set read
 * many at once. The answer itself is in `bodies`, under the same key.
 */
export interface CacheEntry {
  /** `${cacheFormat}|${owner}|${hash of the query key}` (cacheKey). */
  key: string;
  format: number;
  /** The account the answer belongs to. */
  owner: string;
  /** Answers of local days are those of the zone they were asked in. */
  scope: { timezone: string };
  /** The query key's first element ("tracks", "days" …): the policy's resource. */
  resource: string;
  /** The query key the answer is for, to restore it under before the page asks. */
  queryKey: readonly unknown[];
  /** The devices it covers; null for all of the owner's. */
  devices: readonly string[] | null;
  /** When the server answered, or confirmed the answer (TanStack's `dataUpdatedAt`). */
  fetchedAt: number;
  /** When it was last shown or written: what the TTLs and the sweep count from. */
  touchedAt: number;
  /** Where the period it covers ends (epoch ms); null when it covers no period. */
  until: number | null;
  /** An answer about today lives until the day ended and a while after; null otherwise. */
  expiresAt: number | null;
  /** The answer's ETag, sent back as `If-None-Match`. */
  etag: string | null;
  /** The stamps of the days it covers, as the answer carried them. */
  stamps: readonly DayStamp[] | null;
  /** 1 when it may be restored before the first paint (an index holds no booleans). */
  warm: 0 | 1;
  /** About what it takes on disk, for the budgets. */
  bytes: number;
}

/** The one owner the store holds, and what an open without the network needs to paint. */
export interface CacheMeta {
  id: "meta";
  owner: string;
  timezone: string;
  /** The owner's own account as the session probe last returned it. */
  user: SessionUser;
  /** The sum of the entries' bytes. */
  bytes: number;
}
