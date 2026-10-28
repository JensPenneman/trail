import type { CacheEntry, CacheMeta } from "./cacheEntry";
import { cacheFormat } from "./cacheFormat";

const databaseName = "trail-cache";
/** How long an open waits for another tab to let go of an older version of the database. */
const blockedWaitMs = 2000;

/** What a write came to: written, refused for lack of room (`QuotaExceededError`), or failed. */
export type WriteOutcome = "written" | "quota" | "failed";

/** An entry and its answer, as stored. */
export interface StoredEntry {
  entry: CacheEntry;
  body: unknown;
}

/** A change of an entry's times that leaves its answer as it is. */
export interface EntryTouch {
  key: string;
  touchedAt: number;
  /** A revalidation that found the answer unchanged moves this too… */
  fetchedAt?: number;
  /** …and may come with another validator for the same answer. */
  etag?: string | null;
}

/**
 * The browser's copy of the owner's answers, in IndexedDB `trail-cache`:
 * `entries` (what is known of each answer: owner, scope, times, validators,
 * size; indexes `owner`, `touchedAt`, `warm`), `bodies` (the answers, under
 * the same keys, read only when one is restored) and `meta` (the one owner
 * and the total size). Every method resolves, also when the browser refuses:
 * a store that fails reads nothing and writes nothing.
 */
export interface CacheStore {
  readMeta(): Promise<CacheMeta | null>;
  /** The owner and their account, keeping the total size. */
  writeMeta(meta: Omit<CacheMeta, "id" | "bytes">): Promise<boolean>;
  read(key: string): Promise<StoredEntry | null>;
  /** The entries that may be restored before the first paint, with their answers. */
  readWarm(): Promise<StoredEntry[]>;
  /** Every entry, without the answers. */
  list(): Promise<CacheEntry[]>;
  write(entry: CacheEntry, body: unknown): Promise<WriteOutcome>;
  touch(touches: readonly EntryTouch[]): Promise<void>;
  remove(keys: readonly string[]): Promise<void>;
  /** Everything, the owner too. */
  clear(): Promise<boolean>;
  close(): void;
}

const isQuotaError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");

/** Resolves when the transaction commits; `failed` with its error when it does not. */
function settle(
  transaction: IDBTransaction,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  return new Promise((resolve) => {
    transaction.oncomplete = () => resolve({ ok: true });
    transaction.onerror = (event) => {
      // the transaction aborts next; that event reports it
      event.preventDefault();
    };
    transaction.onabort = () => resolve({ ok: false, error: transaction.error });
  });
}

function requested<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (database: IDBDatabase | null) => {
      if (settled) {
        database?.close();
        return;
      }
      settled = true;
      clearTimeout(blockedTimer);
      resolve(database);
    };
    let blockedTimer: ReturnType<typeof setTimeout> | undefined;
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(databaseName, cacheFormat);
    } catch {
      finish(null);
      return;
    }
    // Another version of the format: start empty. Answers of an older one may mean something else.
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of [...database.objectStoreNames]) database.deleteObjectStore(name);
      const entries = database.createObjectStore("entries", { keyPath: "key" });
      entries.createIndex("owner", "owner");
      entries.createIndex("touchedAt", "touchedAt");
      entries.createIndex("warm", "warm");
      database.createObjectStore("bodies", { keyPath: "key" });
      database.createObjectStore("meta", { keyPath: "id" });
    };
    request.onsuccess = () => finish(request.result);
    // A newer format already opened it (a newer build in another tab): this page keeps memory only.
    request.onerror = (event) => {
      event.preventDefault();
      finish(null);
    };
    request.onblocked = () => {
      blockedTimer = setTimeout(() => finish(null), blockedWaitMs);
    };
  });
}

/**
 * Opens the store, or null where the browser has no IndexedDB, refuses it
 * (some private windows) or holds it at a newer format: the page then keeps
 * what it loads in memory only, as before there was a store.
 */
export async function openCacheStore(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<CacheStore | null> {
  if (factory === undefined) return null;
  const database = await openDatabase(factory);
  if (database === null) return null;
  let open = true;
  // Another tab opens a newer format: let it, and keep memory only here.
  database.onversionchange = () => {
    open = false;
    database.close();
  };
  database.onclose = () => {
    open = false;
  };

  const transaction = (
    names: readonly ("entries" | "bodies" | "meta")[],
    mode: IDBTransactionMode,
  ): IDBTransaction | null => {
    if (!open) return null;
    try {
      return database.transaction([...names], mode);
    } catch {
      return null;
    }
  };

  return {
    async readMeta() {
      const tx = transaction(["meta"], "readonly");
      if (tx === null) return null;
      try {
        const meta = await requested<CacheMeta | undefined>(tx.objectStore("meta").get("meta"));
        return meta ?? null;
      } catch {
        return null;
      }
    },

    async writeMeta({ owner, timezone, user }) {
      const tx = transaction(["meta"], "readwrite");
      if (tx === null) return false;
      const done = settle(tx);
      try {
        const store = tx.objectStore("meta");
        const read = store.get("meta");
        read.onsuccess = () => {
          const previous = read.result as CacheMeta | undefined;
          const meta: CacheMeta = {
            id: "meta",
            owner,
            timezone,
            user,
            bytes: previous?.bytes ?? 0,
          };
          store.put(meta);
        };
      } catch {
        tx.abort();
      }
      return (await done).ok;
    },

    async read(key) {
      const tx = transaction(["entries", "bodies"], "readonly");
      if (tx === null) return null;
      try {
        const [entry, body] = await Promise.all([
          requested<CacheEntry | undefined>(tx.objectStore("entries").get(key)),
          requested<{ body: unknown } | undefined>(tx.objectStore("bodies").get(key)),
        ]);
        return entry === undefined || body === undefined ? null : { entry, body: body.body };
      } catch {
        return null;
      }
    },

    async readWarm() {
      const tx = transaction(["entries", "bodies"], "readonly");
      if (tx === null) return [];
      try {
        const entries = await requested<CacheEntry[]>(
          tx.objectStore("entries").index("warm").getAll(1),
        );
        const bodies = tx.objectStore("bodies");
        const read = await Promise.all(
          entries.map((entry) =>
            requested<{ body: unknown } | undefined>(bodies.get(entry.key)).then((body) =>
              body === undefined ? null : { entry, body: body.body },
            ),
          ),
        );
        return read.filter((stored) => stored !== null);
      } catch {
        return [];
      }
    },

    async list() {
      const tx = transaction(["entries"], "readonly");
      if (tx === null) return [];
      try {
        return await requested<CacheEntry[]>(tx.objectStore("entries").getAll());
      } catch {
        return [];
      }
    },

    async write(entry, body) {
      const tx = transaction(["entries", "bodies", "meta"], "readwrite");
      if (tx === null) return "failed";
      const done = settle(tx);
      try {
        const entries = tx.objectStore("entries");
        const meta = tx.objectStore("meta");
        const previous = entries.get(entry.key);
        const current = meta.get("meta");
        previous.onsuccess = () => {
          current.onsuccess = () => {
            const stored = current.result as CacheMeta | undefined;
            // Only for the owner the store holds: a purge in another tab may have removed them.
            if (stored === undefined || stored.owner !== entry.owner) {
              tx.abort();
              return;
            }
            const replaced = (previous.result as CacheEntry | undefined)?.bytes ?? 0;
            entries.put(entry);
            tx.objectStore("bodies").put({ key: entry.key, body });
            meta.put({ ...stored, bytes: Math.max(0, stored.bytes - replaced) + entry.bytes });
          };
        };
      } catch (error) {
        if (isQuotaError(error)) return "quota";
        tx.abort();
      }
      const outcome = await done;
      if (outcome.ok) return "written";
      return isQuotaError(outcome.error) ? "quota" : "failed";
    },

    async touch(touches) {
      if (touches.length === 0) return;
      const tx = transaction(["entries"], "readwrite");
      if (tx === null) return;
      const done = settle(tx);
      try {
        const entries = tx.objectStore("entries");
        for (const touch of touches) {
          const read = entries.get(touch.key);
          read.onsuccess = () => {
            const entry = read.result as CacheEntry | undefined;
            if (entry === undefined) return;
            entries.put({
              ...entry,
              touchedAt: Math.max(entry.touchedAt, touch.touchedAt),
              ...(touch.fetchedAt === undefined
                ? {}
                : { fetchedAt: Math.max(entry.fetchedAt, touch.fetchedAt) }),
              ...(touch.etag === undefined ? {} : { etag: touch.etag }),
            });
          };
        }
      } catch {
        tx.abort();
      }
      await done;
    },

    async remove(keys) {
      if (keys.length === 0) return;
      const tx = transaction(["entries", "bodies", "meta"], "readwrite");
      if (tx === null) return;
      const done = settle(tx);
      try {
        const entries = tx.objectStore("entries");
        const bodies = tx.objectStore("bodies");
        const meta = tx.objectStore("meta");
        let removed = 0;
        let pending = keys.length;
        const current = meta.get("meta");
        const finish = () => {
          pending -= 1;
          if (pending > 0) return;
          const read = () => {
            const stored = current.result as CacheMeta | undefined;
            if (stored !== undefined) {
              meta.put({ ...stored, bytes: Math.max(0, stored.bytes - removed) });
            }
          };
          if (current.readyState === "done") read();
          else current.onsuccess = read;
        };
        for (const key of keys) {
          const read = entries.get(key);
          read.onsuccess = () => {
            const entry = read.result as CacheEntry | undefined;
            if (entry !== undefined) removed += entry.bytes;
            entries.delete(key);
            bodies.delete(key);
            finish();
          };
        }
      } catch {
        tx.abort();
      }
      await done;
    },

    async clear() {
      const tx = transaction(["entries", "bodies", "meta"], "readwrite");
      if (tx === null) return false;
      const done = settle(tx);
      try {
        for (const name of ["entries", "bodies", "meta"] as const) tx.objectStore(name).clear();
      } catch {
        tx.abort();
      }
      return (await done).ok;
    },

    close() {
      open = false;
      database.close();
    },
  };
}
