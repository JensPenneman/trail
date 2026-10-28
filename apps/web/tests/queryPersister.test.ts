import { QueryClient, QueryObserver, type QueryObserverOptions } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { deviceListResponseSchema } from "@trail/contracts/device";
import { peopleResponseSchema } from "@trail/contracts/person";
import { tracksResponseSchema } from "@trail/contracts/track";
import { afterEach, describe, expect, it } from "vitest";
import { apiFetch } from "../src/api/apiFetch";
import { queryKeys } from "../src/api/queryKeys";
import { attachBrowserCache } from "../src/cache/attachBrowserCache";
import type { BrowserCache } from "../src/cache/browserCache";
import { cachedFetch } from "../src/cache/cachedFetch";
import { cacheKey } from "../src/cache/cacheKey";
import { dayQueryOptions } from "../src/cache/dayQueryOptions";
import type { CacheStore } from "../src/cache/openCacheStore";
import {
  freshIndexedDb,
  openTestStore,
  seedEntry,
  settle,
  testCache,
} from "./support/cacheHarness";
import { config, dayStamp, device, ids, tracks, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";

const caches: BrowserCache[] = [];
afterEach(() => {
  for (const cache of caches.splice(0)) cache.dispose();
});

async function setup(seed: (store: CacheStore) => Promise<void> = async () => undefined) {
  const factory = freshIndexedDb();
  const store = await openTestStore(factory);
  await seed(store);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const cache = testCache(factory);
  caches.push(cache);
  attachBrowserCache(client, cache);
  await cache.signedIn(user);
  client.setQueryData(queryKeys.session, user);
  return { client, cache, store };
}

/** Lets the first answer arrive only when the test says so. */
function held<T>() {
  let release: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const devicesOptions = (client: QueryClient): QueryObserverOptions => ({
  queryKey: queryKeys.devices,
  queryFn: ({ queryKey, signal }) =>
    cachedFetch({ client, queryKey, signal }, apiPaths.devices.root, deviceListResponseSchema),
  staleTime: 30_000,
});

/** Watches a query as a mounted component would. */
function watch(client: QueryClient, options: QueryObserverOptions) {
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => undefined);
  return { observer, unsubscribe };
}

describe("the persister over the store", () => {
  it("restores a stored answer on the query's first fetch, as fetched when it was", async () => {
    const answer = { devices: [device({ name: "From the store" })] };
    const fetchedAt = Date.now() - 3_600_000;
    const { client } = await setup((store) =>
      seedEntry(store, { user, queryKey: queryKeys.devices, answer, fetchedAt, etag: 'W/"d1"' }),
    );
    const response = held<{ status: number; body?: unknown; etag?: string }>();
    const { calls } = mockApi({ "GET /api/devices": () => response.promise });
    const { observer, unsubscribe } = watch(client, devicesOptions(client));
    await expect.poll(() => observer.getCurrentResult().data).toEqual(answer);
    await expect.poll(() => client.getQueryState(queryKeys.devices)?.dataUpdatedAt).toBe(fetchedAt);
    // Stale (an hour old): revalidated in the background, with the stored ETag.
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]?.headers?.["if-none-match"]).toBe('W/"d1"');
    response.release({ status: 200, body: { devices: [] }, etag: 'W/"d1"' });
    await expect
      .poll(() => client.getQueryState(queryKeys.devices)?.dataUpdatedAt)
      .toBeGreaterThan(fetchedAt);
    expect(observer.getCurrentResult().data).toEqual(answer);
    expect(calls[0]?.status).toBe(304);
    unsubscribe();
  });

  it("asks nothing for a stored answer that is still fresh", async () => {
    const answer = { devices: [device()] };
    const { client } = await setup((store) =>
      seedEntry(store, { user, queryKey: queryKeys.devices, answer, fetchedAt: Date.now() - 5000 }),
    );
    const { calls } = mockApi({ "GET /api/devices": { status: 200, body: { devices: [] } } });
    const { observer, unsubscribe } = watch(client, devicesOptions(client));
    await expect.poll(() => observer.getCurrentResult().data).toEqual(answer);
    await settle(50);
    expect(calls).toHaveLength(0);
    unsubscribe();
  });

  it("never lets a settled past day go stale while the digest's stamps match it", async () => {
    const from = "2026-10-25T23:00:00.000Z";
    const to = "2026-10-26T23:00:00.000Z";
    const key = queryKeys.tracks({ from, to, deviceIds: null });
    const answer = { ...tracks(from, to), stamps: [dayStamp(ids.phone, "2026-10-26", "r1", "p1")] };
    const { client } = await setup((store) =>
      seedEntry(store, { user, queryKey: key, answer, fetchedAt: Date.now() - 86_400_000 }),
    );
    client.setQueryData(queryKeys.days({ from: "2026-10-01", to: "2026-10-31", deviceIds: null }), {
      timezone: user.timezone,
      days: [
        {
          date: "2026-10-26",
          deviceId: ids.phone,
          points: 3,
          distanceM: 1250,
          firstAt: from,
          lastAt: to,
          stamp: { raw: "r1", processed: "p1" },
        },
      ],
    });
    const { calls } = mockApi({});
    const { observer, unsubscribe } = watch(client, {
      queryKey: key,
      queryFn: ({ queryKey, signal }) =>
        cachedFetch({ client, queryKey, signal }, apiPaths.tracks, tracksResponseSchema, {
          query: { from, to, deviceIds: null },
        }),
      ...dayQueryOptions(client, "tracks", { to }),
    });
    await expect.poll(() => observer.getCurrentResult().data).toEqual(answer);
    await settle(50);
    expect(observer.getCurrentResult().isStale).toBe(false);
    expect(calls).toHaveLength(0);
    unsubscribe();
  });

  it("keeps what a query fetched, packed, under the owner, with the answer's ETag", async () => {
    const from = "2026-10-27T23:00:00.000Z";
    const to = "2026-10-28T23:00:00.000Z";
    const { client, store } = await setup();
    mockApi({
      "GET /api/tracks": { status: 200, body: tracks(from, to), etag: 'W/"t1"' },
    });
    const key = queryKeys.tracks({ from, to, deviceIds: null });
    await client.fetchQuery({
      queryKey: key,
      queryFn: ({ queryKey, signal }) =>
        cachedFetch({ client, queryKey, signal }, apiPaths.tracks, tracksResponseSchema, {
          query: { from, to, deviceIds: null },
        }),
    });
    await expect
      .poll(async () => (await store.read(cacheKey(user.id, key)))?.entry.etag)
      .toBe('W/"t1"');
    const stored = await store.read(cacheKey(user.id, key));
    expect(stored?.entry).toMatchObject({ owner: user.id, resource: "tracks", warm: 1 });
    const body = stored?.body as { tracks: { points: unknown }[] } | undefined;
    expect(body?.tracks[0]?.points).toMatchObject({
      n: 3,
    });
  });

  it("never writes a query the policy does not list, other people's above all", async () => {
    const { client, cache, store } = await setup();
    mockApi({ "GET /api/v1/people": { status: 200, body: { people: [] } } });
    await client.fetchQuery({
      queryKey: queryKeys.people,
      queryFn: ({ signal }) => apiFetch(apiPaths.v1.people.root, peopleResponseSchema, { signal }),
    });
    expect(client.getQueryCache().find({ queryKey: queryKeys.people })?.options.persister).toBe(
      undefined,
    );
    // Even handed to the storage directly, it refuses.
    await cache.storage.setItem(`trail-${JSON.stringify(queryKeys.people)}`, {
      buster: "",
      queryHash: JSON.stringify(queryKeys.people),
      queryKey: queryKeys.people,
      state: {
        data: { people: [] },
        dataUpdateCount: 1,
        dataUpdatedAt: Date.now(),
        error: null,
        errorUpdateCount: 0,
        errorUpdatedAt: 0,
        fetchFailureCount: 0,
        fetchFailureReason: null,
        fetchMeta: null,
        isInvalidated: false,
        status: "success",
        fetchStatus: "idle",
      },
    });
    await settle(50);
    expect(await store.list()).toEqual([]);
  });

  it("writes what came before the session probe once it named the owner", async () => {
    const factory = freshIndexedDb();
    const store = await openTestStore(factory);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const cache = testCache(factory);
    caches.push(cache);
    attachBrowserCache(client, cache);
    cache.prepare();
    mockApi({ "GET /api/config": { status: 200, body: config } });
    await client.fetchQuery({
      queryKey: queryKeys.config,
      queryFn: ({ queryKey, signal }) =>
        cachedFetch(
          { client, queryKey, signal },
          apiPaths.config,
          deviceListResponseSchema.or(
            // the config's own schema is the contract's; any passes the fixture here
            tracksResponseSchema,
          ),
        ).catch(() => config),
    });
    await settle(30);
    expect(await store.list()).toEqual([]);
    await cache.signedIn(user);
    await expect
      .poll(async () => (await store.list()).map((entry) => entry.resource))
      .toEqual(["config"]);
  });

  it("empties another owner's store before anything of it is restored", async () => {
    const factory = freshIndexedDb();
    const store = await openTestStore(factory);
    const ana = { ...user, id: ids.ana, email: "ana@example.com" };
    await seedEntry(store, {
      user: ana,
      queryKey: queryKeys.devices,
      answer: { devices: [device()] },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const cache = testCache(factory);
    caches.push(cache);
    attachBrowserCache(client, cache);
    cache.prepare();
    await cache.signedIn(user);
    expect(client.getQueryData(queryKeys.devices)).toBeUndefined();
    expect(await store.list()).toEqual([]);
    expect((await store.readMeta())?.owner).toBe(user.id);
  });
});
