import type { AsyncStorage, PersistedQuery } from "@tanstack/query-persist-client-core";
import type { QueryClient, QueryKey, QueryState } from "@tanstack/react-query";
import type { SessionUser } from "@trail/contracts/user";
import { codecFor } from "./cacheCodecs";
import type { CacheMeta } from "./cacheEntry";
import { cacheKey } from "./cacheKey";
import { hardBudgetBytes, policyOf, softBudgetBytes } from "./cachePolicy";
import { type CacheStats, createCacheStats } from "./cacheStats";
import { readCacheToggle, writeCacheToggle } from "./cacheToggle";
import { cacheValidators } from "./cacheValidators";
import { decodeEntry } from "./decodeEntry";
import { encodeEntry } from "./encodeEntry";
import {
  type CacheStore,
  type EntryTouch,
  openCacheStore,
  type StoredEntry,
} from "./openCacheStore";
import { persisterPrefix } from "./queryPersister";
import { restoreWarmSet } from "./restoreWarmSet";
import { sweepEntries } from "./sweepEntries";

/** Why the copy was emptied (docs/architecture.md §14): every one of them purges. */
export type PurgeReason =
  | "sign-out"
  | "account-deleted"
  | "session-lost"
  | "owner-change"
  | "toggle-off"
  | "cleared";

/** A warm read slower than this stops the first paint waiting for it (§14). */
const warmWaitMs = 300;
/** Touches of restored entries are written together. */
const touchDelayMs = 1000;
const hourMs = 60 * 60_000;
const startupSweepDelayMs = 2000;
/** Writes made before the probe said whose session it is wait at most this long. */
const pendingLimit = 32;
const persistAskedKey = "trail.cache.persist";

type Message =
  | { type: "purge"; reason: PurgeReason }
  | { type: "toggle"; on: boolean }
  | { type: "zone"; timezone: string };

const isMessage = (value: unknown): value is Message =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  (value.type === "purge" || value.type === "toggle" || value.type === "zone");

interface WarmRead {
  meta: CacheMeta | null;
  entries: StoredEntry[];
}

interface Owner {
  id: string;
  timezone: string;
}

/** What the store can say right now, for Settings. */
export interface CacheState {
  /** This browser keeps a copy (the toggle). */
  on: boolean;
  /** The browser gives it a store (IndexedDB) and room; false means memory only. */
  available: boolean;
  /** The owner the copy belongs to, once the session said so. */
  owner: string | null;
}

export interface BrowserCache {
  readonly stats: CacheStats;
  /** The persister's storage: the store, for the signed-in owner only. */
  readonly storage: AsyncStorage<PersistedQuery>;
  /** The query client whose answers it keeps (attachBrowserCache). */
  attach(client: QueryClient): void;
  /** Starts reading the store before the session is known: who it belongs to and the warm set. */
  prepare(): void;
  /**
   * The session probe named the owner: a store of someone else's is emptied
   * before anything is restored, then the warm set goes into the query cache.
   * Resolves once it did, or after the first paint's wait for it.
   */
  signedIn(user: SessionUser): Promise<void>;
  /** The account the copy belongs to, for an open whose session cannot be checked (offline). */
  offlineUser(): Promise<SessionUser | null>;
  /** Paints from the copy without the session: binds it to the account it holds, restores the warm set. */
  paintOffline(user: SessionUser): Promise<void>;
  purge(reason: PurgeReason): Promise<void>;
  /** Settings' Clear the copy: empties it; what the pages load next is kept again. */
  clearCopy(): Promise<void>;
  setOn(on: boolean): Promise<void>;
  /** A deleted device: every entry that may hold its data goes. */
  forgetDevice(deviceId: string): Promise<void>;
  /** Keeps a query's answer after a change made in place (the `days` event). */
  persistNow(queryKey: QueryKey): void;
  /** The bytes the copy takes, as the store counts them. */
  bytes(): Promise<number>;
  state(): CacheState;
  subscribe(listener: () => void): () => void;
  /** Stops its timers and lets go of the store (tests, a page going away). */
  dispose(): void;
}

export interface BrowserCacheOptions {
  /** The toggle; read from this browser's localStorage by default. */
  on?: boolean;
  openStore?: () => Promise<CacheStore | null>;
  now?: () => number;
  /** Tabs tell each other about purges and the toggle; null for none. */
  channel?: BroadcastChannel | null;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

/** The query key of a persister storage key (`trail-<queryHash>`; the hash is the key as JSON). */
function queryKeyOf(storageKey: string): unknown[] | null {
  const prefix = `${persisterPrefix}-`;
  if (!storageKey.startsWith(prefix)) return null;
  try {
    const parsed: unknown = JSON.parse(storageKey.slice(prefix.length));
    return isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function persistedQuery(queryKey: unknown[], answer: unknown, fetchedAt: number): PersistedQuery {
  const state: QueryState = {
    data: answer,
    dataUpdateCount: 1,
    dataUpdatedAt: fetchedAt,
    error: null,
    errorUpdateCount: 0,
    errorUpdatedAt: 0,
    fetchFailureCount: 0,
    fetchFailureReason: null,
    fetchMeta: null,
    isInvalidated: false,
    status: "success",
    fetchStatus: "idle",
  };
  return { buster: "", queryHash: JSON.stringify(queryKey), queryKey, state };
}

/**
 * The browser's copy of the signed-in person's own answers (docs/architecture.md
 * §14): the store, bound to one owner at a time by the session probe, the
 * persister's storage over it, the warm set, the budgets and the sweep, the
 * purges and the tabs that hear of them. Nothing is read before the probe
 * named whose session this is, and nothing is written for anyone else.
 */
export function createBrowserCache(options: BrowserCacheOptions = {}): BrowserCache {
  const now = options.now ?? Date.now;
  const stats = createCacheStats();
  const listeners = new Set<() => void>();
  let on = options.on ?? readCacheToggle();
  let client: QueryClient | null = null;
  let storePromise: Promise<CacheStore | null> | null = null;
  let available = true;
  let owner: Owner | null = null;
  let account: SessionUser | null = null;
  /** Bumped by every purge and every new owner: work started before it stops. */
  let generation = 0;
  let binding: Promise<void> | null = null;
  /** Whose account `binding` binds. */
  let bindingFor: string | null = null;
  /** The probe is on its way at start-up: writes wait for it rather than being dropped. */
  let awaitingOwner = false;
  const pending = new Map<string, { queryKey: unknown[]; answer: unknown; fetchedAt: number }>();
  /** The answer object each key holds in the store: writing the same one again is a touch. */
  let writtenAs = new WeakMap<object, string>();
  /** The bytes of the entries this page knows of, on top of `baseBytes` it does not. */
  let sizes = new Map<string, number>();
  let baseBytes = 0;
  const touches = new Map<string, EntryTouch>();
  let touchTimer: ReturnType<typeof setTimeout> | undefined;
  let sweepTimer: ReturnType<typeof setTimeout> | undefined;
  let hourly: ReturnType<typeof setInterval> | undefined;
  let warm: Promise<WarmRead> | null = null;
  let warmStartedAt = 0;
  let unsubscribeSession: (() => void) | null = null;
  let snapshot: CacheState = { on, available: true, owner: null };
  const channel =
    options.channel !== undefined
      ? options.channel
      : typeof BroadcastChannel === "function"
        ? new BroadcastChannel("trail-cache")
        : null;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const store = (): Promise<CacheStore | null> => {
    storePromise ??= (options.openStore ?? (() => openCacheStore()))().then((opened) => {
      if (opened === null) {
        available = false;
        notify();
      }
      return opened;
    });
    return storePromise;
  };

  const total = (): number =>
    baseBytes + [...sizes.values()].reduce((sum, bytes) => sum + bytes, 0);

  /** Forgets this page's state of the copy: its owner, what it wrote, its timers. */
  const forget = () => {
    generation += 1;
    owner = null;
    account = null;
    binding = null;
    bindingFor = null;
    awaitingOwner = false;
    pending.clear();
    writtenAs = new WeakMap();
    sizes = new Map();
    baseBytes = 0;
    touches.clear();
    clearTimeout(touchTimer);
    clearTimeout(sweepTimer);
    clearInterval(hourly);
    hourly = undefined;
    if (client !== null) cacheValidators.clear(client);
    stats.reset();
    notify();
  };

  const flushTouches = async () => {
    const batch = [...touches.values()];
    touches.clear();
    const opened = await store();
    await opened?.touch(batch);
  };

  const touch = (key: string, fetchedAt?: number, etag?: string | null) => {
    const previous = touches.get(key);
    const fetched = Math.max(fetchedAt ?? 0, previous?.fetchedAt ?? 0);
    const validator = etag === undefined ? previous?.etag : etag;
    touches.set(key, {
      key,
      touchedAt: now(),
      ...(fetched > 0 ? { fetchedAt: fetched } : {}),
      ...(validator === undefined ? {} : { etag: validator }),
    });
    clearTimeout(touchTimer);
    touchTimer = setTimeout(() => void flushTouches(), touchDelayMs);
  };

  const sweep = async (targetBytes: number) => {
    const gen = generation;
    const opened = await store();
    if (opened === null || owner === null) return;
    const entries = await opened.list();
    if (gen !== generation) return;
    const result = sweepEntries({ entries, owner: owner.id, now: now(), targetBytes });
    if (result.remove.length > 0) await opened.remove(result.remove);
    if (gen !== generation) return;
    const removed = new Set(result.remove);
    sizes = new Map(
      entries.filter((entry) => !removed.has(entry.key)).map((entry) => [entry.key, entry.bytes]),
    );
    baseBytes = 0;
    stats.add("sweeps");
    stats.add("swept", result.remove.length);
    notify();
  };

  const scheduleSweep = (ms: number) => {
    clearTimeout(sweepTimer);
    sweepTimer = setTimeout(() => void sweep(softBudgetBytes), ms);
  };

  /** Asks the browser once to keep the store under storage pressure (Chromium grants it quietly to an installed app). */
  const askPersistence = () => {
    try {
      if (window.localStorage.getItem(persistAskedKey) !== null) return;
      window.localStorage.setItem(persistAskedKey, "asked");
      void navigator.storage?.persist?.().catch(() => false);
    } catch {
      // a browser that refuses localStorage is asked never
    }
  };

  const write = async (queryKey: unknown[], answer: unknown, fetchedAt: number) => {
    if (!on || !available || stats.get().memoryOnly || answer === undefined) return;
    if (policyOf(queryKey) === null) return;
    if (owner === null) {
      if (awaitingOwner && pending.size < pendingLimit) {
        pending.set(JSON.stringify(queryKey), { queryKey, answer, fetchedAt });
      }
      return;
    }
    const gen = generation;
    const opened = await store();
    if (opened === null || gen !== generation || owner === null) return;
    const codec = await codecFor(queryKey);
    if (codec === null || gen !== generation || owner === null) return;
    const etag = client === null ? null : cacheValidators.get(client, queryKey);
    const encoded = encodeEntry(
      {
        owner: owner.id,
        timezone: owner.timezone,
        queryKey,
        answer,
        fetchedAt,
        etag,
        now: now(),
      },
      codec,
    );
    if (encoded === null) {
      stats.add("refused");
      return;
    }
    const { entry, body } = encoded;
    if (typeof answer === "object" && answer !== null && writtenAs.get(answer) === entry.key) {
      // The answer the store holds, confirmed (a 304, matching stamps, an equal body).
      touch(entry.key, fetchedAt, etag);
      return;
    }
    if (total() - (sizes.get(entry.key) ?? 0) + entry.bytes > hardBudgetBytes) {
      // Past the hard budget nothing is written until the sweep made room.
      stats.add("refused");
      scheduleSweep(0);
      return;
    }
    let outcome = await opened.write(entry, body);
    if (outcome === "quota") {
      await sweep(softBudgetBytes / 2);
      if (gen !== generation) return;
      outcome = await opened.write(entry, body);
      if (outcome === "quota") {
        stats.memoryOnly();
        notify();
        return;
      }
    }
    if (outcome !== "written") {
      stats.add("refused");
      return;
    }
    if (gen !== generation) return;
    if (typeof answer === "object" && answer !== null) writtenAs.set(answer, entry.key);
    sizes.set(entry.key, entry.bytes);
    if (total() > softBudgetBytes) scheduleSweep(touchDelayMs);
    askPersistence();
  };

  /** Binds the store to an account: someone else's copy goes first, an old zone's days go. */
  const bind = async (user: SessionUser) => {
    const gen = ++generation;
    const opened = on ? await store() : null;
    if (opened === null || gen !== generation) return;
    const meta = await opened.readMeta();
    if (gen !== generation) return;
    if (meta !== null && meta.owner !== user.id) {
      await opened.clear();
      channel?.postMessage({ type: "purge", reason: "owner-change" } satisfies Message);
    } else if (meta !== null && meta.timezone !== user.timezone) {
      await removeZoned(opened, user.timezone);
    }
    if (gen !== generation) return;
    if (!(await opened.writeMeta({ owner: user.id, timezone: user.timezone, user }))) return;
    if (gen !== generation) return;
    owner = { id: user.id, timezone: user.timezone };
    account = user;
    baseBytes = meta !== null && meta.owner === user.id ? meta.bytes : 0;
    awaitingOwner = false;
    const waiting = [...pending.values()];
    pending.clear();
    for (const { queryKey, answer, fetchedAt } of waiting) void write(queryKey, answer, fetchedAt);
    scheduleSweep(startupSweepDelayMs);
    clearInterval(hourly);
    hourly = setInterval(() => void sweep(softBudgetBytes), hourMs);
    notify();
  };

  /** Removes the answers about local days of any other zone than `timezone`. */
  const removeZoned = async (opened: CacheStore, timezone: string) => {
    const entries = await opened.list();
    const zoned = entries.filter(
      (entry) => policyOf(entry.queryKey)?.zoned === true && entry.scope.timezone !== timezone,
    );
    await opened.remove(zoned.map((entry) => entry.key));
    for (const entry of zoned) sizes.delete(entry.key);
  };

  /** Restores the warm set read at start-up, if it is this owner's. */
  const applyWarm = async (user: SessionUser) => {
    if (warm === null || client === null) return;
    const read = await warm;
    if (read.meta === null || read.meta.owner !== user.id || owner?.id !== user.id) return;
    const codecs = new Map(
      await Promise.all(
        read.entries.map(async ({ entry }) => [entry.key, await codecFor(entry.queryKey)] as const),
      ),
    );
    if (owner?.id !== user.id) return;
    const restored = restoreWarmSet(
      client,
      read.entries,
      { owner: user.id, timezone: user.timezone, now: now() },
      codecs,
    );
    stats.add("restored", restored.restored);
    stats.add("restoredBytes", restored.bytes);
    stats.add("hits", restored.restored);
    stats.add("invalid", restored.invalid.length);
    for (const [key, answer] of restored.answers) {
      if (typeof answer === "object" && answer !== null) writtenAs.set(answer, key);
      touch(key);
    }
    const gone = [...restored.invalid, ...restored.expired];
    if (gone.length > 0) void (await store())?.remove(gone);
    if (restored.restored > 0) performance.mark?.("trail:first-data");
  };

  const signedIn = async (user: SessionUser) => {
    if (owner !== null && owner.id === user.id) {
      if (owner.timezone !== user.timezone) {
        // New answers are the new zone's from now on; the old zone's days go.
        owner = { id: user.id, timezone: user.timezone };
        channel?.postMessage({ type: "zone", timezone: user.timezone } satisfies Message);
        const opened = await store();
        if (opened !== null) await removeZoned(opened, user.timezone);
      }
      if (account !== user) {
        account = user;
        void (await store())?.writeMeta({ owner: user.id, timezone: user.timezone, user });
      }
      return;
    }
    if (owner !== null) {
      // Another account in this page (signed in elsewhere in this browser): nothing of the
      // previous one may be kept for the new one, on disk or on screen.
      forget();
      client?.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" });
    }
    if (binding === null || bindingFor !== user.id) {
      binding = bind(user).then(() => applyWarm(user));
      bindingFor = user.id;
    }
    const started = binding;
    // The first paint waits for the warm set at most this long; a later sign-in for the binding.
    const wait = warm === null ? warmWaitMs : Math.max(0, warmStartedAt + warmWaitMs - now());
    await Promise.race([started, delay(wait)]);
    // The account changed while it was being bound (its zone, its name): the copy follows it.
    void started.then(() => {
      if (owner?.id === user.id && (owner.timezone !== user.timezone || account !== user)) {
        void signedIn(user);
      }
    });
  };

  /** A query's stored answer, checked, for the persister to restore; null to ask the server. */
  const readItem = async (storageKey: string): Promise<PersistedQuery | null> => {
    const queryKey = queryKeyOf(storageKey);
    if (!on || queryKey === null || policyOf(queryKey) === null) return null;
    if (owner === null && binding !== null) await Promise.race([binding, delay(warmWaitMs)]);
    const bound = owner;
    if (bound === null) return null;
    const gen = generation;
    const opened = await store();
    if (opened === null) return null;
    const key = cacheKey(bound.id, queryKey);
    const stored = await opened.read(key);
    const codec = stored === null ? null : await codecFor(queryKey);
    if (gen !== generation) return null;
    if (stored === null) {
      stats.add("misses");
      return null;
    }
    const decoded = decodeEntry(
      stored.entry,
      stored.body,
      { owner: bound.id, timezone: bound.timezone, now: now() },
      codec,
    );
    if (!decoded.ok) {
      if (decoded.failure !== "expired") stats.add("invalid");
      stats.add("misses");
      void opened.remove([key]);
      return null;
    }
    if (client !== null) cacheValidators.set(client, queryKey, stored.entry.etag);
    if (typeof decoded.answer === "object" && decoded.answer !== null) {
      writtenAs.set(decoded.answer, key);
    }
    touch(key);
    stats.add("restored");
    stats.add("restoredBytes", stored.entry.bytes);
    stats.add("hits");
    return persistedQuery(queryKey, decoded.answer, stored.entry.fetchedAt);
  };

  const storage: AsyncStorage<PersistedQuery> = {
    async getItem(storageKey) {
      try {
        return await readItem(storageKey);
      } catch {
        // a copy that cannot be read is no copy: the query asks the server
        return null;
      }
    },
    async setItem(_storageKey, persisted) {
      try {
        await write([...persisted.queryKey], persisted.state.data, persisted.state.dataUpdatedAt);
      } catch {
        // a copy that could not be written is a copy fewer, never an error on screen
      }
    },
    async removeItem(storageKey) {
      const queryKey = queryKeyOf(storageKey);
      if (queryKey === null || owner === null) return;
      await (await store())?.remove([cacheKey(owner.id, queryKey)]);
    },
  };

  const onMessage = (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (!isMessage(message)) return;
    if (message.type === "purge") {
      // The tab that purged cleared the store; this one must not write the owner back.
      if (message.reason === "cleared") {
        writtenAs = new WeakMap();
        sizes = new Map();
        baseBytes = 0;
        notify();
      } else forget();
    } else if (message.type === "toggle") {
      on = message.on;
      if (!on) forget();
      notify();
    } else if (owner !== null) {
      owner = { ...owner, timezone: message.timezone };
    }
  };
  channel?.addEventListener("message", onMessage);
  // Back online, a sweep runs: what expired while the page waited goes.
  const onOnline = () => {
    if (owner !== null) scheduleSweep(touchDelayMs);
  };
  if (typeof window !== "undefined") window.addEventListener("online", onOnline);

  const purge = async (reason: PurgeReason) => {
    forget();
    const opened = await store();
    await opened?.clear();
    channel?.postMessage({ type: "purge", reason } satisfies Message);
    notify();
  };

  return {
    stats,
    storage,
    attach(attached) {
      client = attached;
      unsubscribeSession?.();
      const cache = attached.getQueryCache();
      unsubscribeSession = cache.subscribe((event) => {
        if (event.type !== "updated" || event.query.queryKey[0] !== "session") return;
        const data = event.query.state.data as SessionUser | null | undefined;
        if (data === undefined) return;
        // Signed out, the session lost, or the probe found none: nothing stays.
        if (data === null) {
          if (owner !== null || awaitingOwner || binding !== null) void purge("session-lost");
          return;
        }
        void signedIn(data);
      });
    },
    prepare() {
      if (!on || warm !== null) return;
      awaitingOwner = true;
      warmStartedAt = now();
      warm = (async () => {
        const opened = await store();
        if (opened === null) return { meta: null, entries: [] };
        const meta = await opened.readMeta();
        const entries = meta === null ? [] : await opened.readWarm();
        stats.warmRead(now() - warmStartedAt);
        return { meta, entries };
      })();
    },
    signedIn,
    async offlineUser() {
      if (!on) return null;
      const read = warm === null ? null : await warm;
      const meta = read?.meta ?? (await (await store())?.readMeta()) ?? null;
      return meta?.user ?? null;
    },
    async paintOffline(user) {
      if (!on || owner !== null) return;
      owner = { id: user.id, timezone: user.timezone };
      account = user;
      notify();
      await applyWarm(user);
    },
    purge,
    async clearCopy() {
      const user = account;
      await purge("cleared");
      if (user !== null) await bind(user);
    },
    async setOn(next) {
      writeCacheToggle(next);
      on = next;
      channel?.postMessage({ type: "toggle", on: next } satisfies Message);
      if (!next) await purge("toggle-off");
      else if (client !== null) {
        const user = client.getQueryData<SessionUser | null>(["session"]);
        if (user !== undefined && user !== null) await bind(user);
      }
      notify();
    },
    async forgetDevice(deviceId) {
      const opened = await store();
      if (opened === null) return;
      const entries = await opened.list();
      const holding = entries.filter((entry) => {
        if (policyOf(entry.queryKey)?.deviceData !== true) return false;
        return entry.devices === null || entry.devices.includes(deviceId);
      });
      await opened.remove(holding.map((entry) => entry.key));
      for (const entry of holding) sizes.delete(entry.key);
      notify();
    },
    persistNow(queryKey) {
      const query = client?.getQueryCache().find({ queryKey, exact: true });
      if (query?.state.data === undefined) return;
      void write([...query.queryKey], query.state.data, query.state.dataUpdatedAt);
    },
    async bytes() {
      if (!on) return 0;
      const meta = await (await store())?.readMeta();
      return meta?.bytes ?? 0;
    },
    state() {
      const next = {
        on,
        available: available && !stats.get().memoryOnly,
        owner: owner?.id ?? null,
      };
      // The same object while nothing changed: React compares snapshots by identity.
      if (
        next.on !== snapshot.on ||
        next.available !== snapshot.available ||
        next.owner !== snapshot.owner
      ) {
        snapshot = next;
      }
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      clearTimeout(touchTimer);
      clearTimeout(sweepTimer);
      clearInterval(hourly);
      unsubscribeSession?.();
      channel?.removeEventListener("message", onMessage);
      if (typeof window !== "undefined") window.removeEventListener("online", onOnline);
      if (options.channel === undefined) channel?.close();
      void storePromise?.then((opened) => opened?.close());
    },
  };
}
