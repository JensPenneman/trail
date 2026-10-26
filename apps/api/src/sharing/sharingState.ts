import type { SharePrecision } from "@trail/contracts/share";
import type { TrackPoint } from "@trail/contracts/track";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Database } from "../db/database";
import { shares } from "../db/schema/shares";
import { loadGridKey } from "./gridKey";

/** A share of one owner as the live fan-out needs it. */
export interface OwnerShare {
  id: string;
  recipientUserId: string;
  deviceIds: readonly string[] | null;
  precision: SharePrecision;
  historyDays: number | null;
  includeDetails: boolean;
  expiresAt: Date | null;
  hiddenAt: Date | null;
}

/** An owner's shares are looked up again after this long, or at once after a change. */
const cacheMs = 60_000;
/** A public page refreshes every 15 s; its track is built at most this often, however many watch. */
const publicTrackMs = 30_000;
/** Past this many entries, the ones that have run out are swept on the next write. */
const sweepAbove = 500;

interface Cached<T> {
  loadedAt: number;
  value: Promise<T>;
}

/** The entry of `key` while fresh, else a new one from `load` (a failed load is not kept). */
function cached<T>(
  entries: Map<string, Cached<T>>,
  key: string,
  maxAgeMs: number,
  now: number,
  load: () => Promise<T>,
): Promise<T> {
  const entry = entries.get(key);
  if (entry !== undefined && now - entry.loadedAt < maxAgeMs) return entry.value;
  if (entries.size > sweepAbove) {
    for (const [other, { loadedAt }] of entries) {
      if (now - loadedAt >= maxAgeMs) entries.delete(other);
    }
  }
  const value = load();
  value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key);
  });
  entries.set(key, { loadedAt: now, value });
  return value;
}

/**
 * What sharing keeps per process (the app is a single instance): the grid
 * key, loaded once; for every owner whose phone uploads, the shares that
 * receive its positions, cached for a minute; and the tracks of public pages
 * for half a minute. Every change to a share calls `forget(ownerId)`, so
 * stopping, hiding or changing a share takes effect on the next upload, and
 * expiry is checked whenever the list is used.
 */
export class SharingState {
  readonly #db: Database;
  #gridKey: Promise<Buffer> | undefined;
  readonly #byOwner = new Map<string, Cached<OwnerShare[]>>();
  readonly #publicTracks = new Map<string, Cached<TrackPoint[]>>();

  constructor(db: Database) {
    this.#db = db;
  }

  /** The server's key for the grid offsets (created on first use). */
  gridKey(): Promise<Buffer> {
    if (this.#gridKey === undefined) {
      const loading = loadGridKey(this.#db);
      // A failed load (database down) is retried by the next caller.
      loading.catch(() => {
        if (this.#gridKey === loading) this.#gridKey = undefined;
      });
      this.#gridKey = loading;
    }
    return this.#gridKey;
  }

  /** The owner's shares with an account bound (pending ones reach nobody), not stopped. */
  sharesOf(ownerId: string, now = Date.now()): Promise<OwnerShare[]> {
    return cached(this.#byOwner, ownerId, cacheMs, now, () => this.#load(ownerId));
  }

  /** After a change to one of the owner's shares. */
  forget(ownerId: string): void {
    this.#byOwner.delete(ownerId);
  }

  /** The track a public page shows for a device, built by `load` at most every 30 s. */
  publicTrack(
    linkId: string,
    deviceId: string,
    load: () => Promise<TrackPoint[]>,
    now = Date.now(),
  ): Promise<TrackPoint[]> {
    return cached(this.#publicTracks, `${linkId}:${deviceId}`, publicTrackMs, now, load);
  }

  /** After a link was turned off: its tracks go too. */
  forgetLink(linkId: string): void {
    for (const key of this.#publicTracks.keys()) {
      if (key.startsWith(`${linkId}:`)) this.#publicTracks.delete(key);
    }
  }

  async #load(ownerId: string): Promise<OwnerShare[]> {
    const rows = await this.#db
      .select({
        id: shares.id,
        recipientUserId: shares.recipientUserId,
        deviceIds: shares.deviceIds,
        precision: shares.precision,
        historyDays: shares.historyDays,
        includeDetails: shares.includeDetails,
        expiresAt: shares.expiresAt,
        hiddenAt: shares.hiddenAt,
      })
      .from(shares)
      .where(
        and(
          eq(shares.ownerUserId, ownerId),
          isNull(shares.revokedAt),
          isNotNull(shares.recipientUserId),
        ),
      );
    return rows.flatMap(({ recipientUserId, ...share }) =>
      recipientUserId === null ? [] : [{ ...share, recipientUserId }],
    );
  }
}
