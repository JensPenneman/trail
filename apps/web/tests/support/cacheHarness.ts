import type { QueryClient } from "@tanstack/react-query";
import type { SessionUser } from "@trail/contracts/user";
import { IDBFactory } from "fake-indexeddb";
import { attachBrowserCache } from "../../src/cache/attachBrowserCache";
import { type BrowserCache, createBrowserCache } from "../../src/cache/browserCache";
import { codecFor } from "../../src/cache/cacheCodecs";
import { encodeEntry } from "../../src/cache/encodeEntry";
import { type CacheStore, openCacheStore } from "../../src/cache/openCacheStore";

/**
 * A store of its own in a fresh fake IndexedDB, as a browser profile has one:
 * every test that opens one starts empty.
 */
export function freshIndexedDb(): IDBFactory {
  return new IDBFactory();
}

export async function openTestStore(factory: IDBFactory): Promise<CacheStore> {
  const store = await openCacheStore(factory);
  if (store === null) throw new Error("fake-indexeddb did not open");
  return store;
}

/** The browser's copy over `factory`, without other tabs (no BroadcastChannel) unless one is given. */
export function testCache(
  factory: IDBFactory,
  options: { on?: boolean; now?: () => number; channel?: BroadcastChannel | null } = {},
): BrowserCache {
  return createBrowserCache({
    on: options.on ?? true,
    openStore: () => openCacheStore(factory),
    channel: options.channel ?? null,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

/** Attaches a copy to a client and binds it to `user`, as the session probe does on a page load. */
export async function signedInCache(
  client: QueryClient,
  factory: IDBFactory,
  user: SessionUser,
): Promise<BrowserCache> {
  const cache = testCache(factory);
  attachBrowserCache(client, cache);
  cache.prepare();
  await cache.signedIn(user);
  client.setQueryData(["session"], user);
  return cache;
}

/** Puts an answer into the store as the persister would have, for `owner` (meta first). */
export async function seedEntry(
  store: CacheStore,
  input: {
    user: SessionUser;
    queryKey: readonly unknown[];
    answer: unknown;
    fetchedAt?: number;
    touchedAt?: number;
    etag?: string | null;
    timezone?: string;
  },
): Promise<void> {
  const { user } = input;
  const meta = await store.readMeta();
  if (meta === null) {
    await store.writeMeta({ owner: user.id, timezone: user.timezone, user });
  }
  const codec = await codecFor(input.queryKey);
  if (codec === null) throw new Error(`no codec for ${JSON.stringify(input.queryKey)}`);
  const now = input.touchedAt ?? Date.now();
  const encoded = encodeEntry(
    {
      owner: user.id,
      timezone: input.timezone ?? user.timezone,
      queryKey: input.queryKey,
      answer: input.answer,
      fetchedAt: input.fetchedAt ?? now - 10 * 60_000,
      etag: input.etag ?? null,
      now,
    },
    codec,
  );
  if (encoded === null) throw new Error("the policy refused the seeded entry");
  const outcome = await store.write(encoded.entry, encoded.body);
  if (outcome !== "written") throw new Error(`seeding failed: ${outcome}`);
}

/** Waits for IndexedDB and the cache's own timers to settle (writes are scheduled). */
export async function settle(ms = 30): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A page's query client on a warm open: a copy on disk holding what `seed`
 * put there, bound to `user` by the session probe and the warm set restored.
 */
export async function warmClient(
  client: QueryClient,
  user: SessionUser,
  seed: (store: CacheStore) => Promise<void>,
): Promise<{ cache: BrowserCache; store: CacheStore }> {
  const factory = freshIndexedDb();
  const store = await openTestStore(factory);
  await seed(store);
  const cache = await signedInCache(client, factory, user);
  return { cache, store };
}

type RouteAnswer = { status: number; body?: unknown; etag?: string };
type Route =
  | RouteAnswer
  | ((request: {
      url: URL;
      method: string;
      body: unknown;
      headers: Readonly<Record<string, string>>;
    }) => RouteAnswer | Promise<RouteAnswer>);

/** Every route of a mockApi table held until `release()`: a server that has not answered yet. */
export function holdAll(routes: Readonly<Record<string, Route>>): {
  routes: Record<string, Route>;
  release: () => void;
} {
  const waiting: (() => void)[] = [];
  let released = false;
  const held: Record<string, Route> = {};
  for (const [name, route] of Object.entries(routes)) {
    held[name] = async (request) => {
      if (!released) await new Promise<void>((resolve) => waiting.push(resolve));
      return typeof route === "function" ? route(request) : route;
    };
  }
  return {
    routes: held,
    release: () => {
      released = true;
      for (const resolve of waiting.splice(0)) resolve();
    },
  };
}

/** Answers of a route that wait until `release()`, then answer as `answer` says. */
export function heldRoutes(): {
  hold: <T>(answer: () => T) => () => Promise<T>;
  release: () => void;
} {
  const waiting: (() => void)[] = [];
  let released = false;
  return {
    hold:
      <T>(answer: () => T) =>
      () =>
        released
          ? Promise.resolve(answer())
          : new Promise<T>((resolve) => {
              waiting.push(() => resolve(answer()));
            }),
    release: () => {
      released = true;
      for (const resolve of waiting.splice(0)) resolve();
    },
  };
}
