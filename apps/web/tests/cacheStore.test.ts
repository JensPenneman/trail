import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { attachBrowserCache } from "../src/cache/attachBrowserCache";
import { createBrowserCache } from "../src/cache/browserCache";
import { cacheKey } from "../src/cache/cacheKey";
import { type CacheStore, openCacheStore, type WriteOutcome } from "../src/cache/openCacheStore";
import { freshIndexedDb, openTestStore, seedEntry, settle } from "./support/cacheHarness";
import { device, ids, user } from "./support/fixtures";

const devicesKey = cacheKey(user.id, queryKeys.devices);

describe("openCacheStore", () => {
  it("writes, reads and removes entries with their answers", async () => {
    const store = await openTestStore(freshIndexedDb());
    const answer = { devices: [device()] };
    await seedEntry(store, { user, queryKey: queryKeys.devices, answer });
    const read = await store.read(devicesKey);
    expect(read?.entry).toMatchObject({ owner: user.id, resource: "devices", warm: 1 });
    expect(read?.body).toEqual(answer);
    expect(await store.list()).toHaveLength(1);
    expect((await store.readMeta())?.bytes).toBe(read?.entry.bytes);
    await store.remove([devicesKey]);
    expect(await store.read(devicesKey)).toBeNull();
    expect((await store.readMeta())?.bytes).toBe(0);
  });

  it("keeps one owner in meta, with what an offline open needs", async () => {
    const store = await openTestStore(freshIndexedDb());
    expect(await store.readMeta()).toBeNull();
    await store.writeMeta({ owner: user.id, timezone: user.timezone, user });
    expect(await store.readMeta()).toEqual({
      id: "meta",
      owner: user.id,
      timezone: user.timezone,
      user,
      bytes: 0,
    });
  });

  it("writes nothing for an owner the store does not hold (a purge in another tab)", async () => {
    const store = await openTestStore(freshIndexedDb());
    await seedEntry(store, { user, queryKey: queryKeys.devices, answer: { devices: [device()] } });
    const [entry] = await store.list();
    if (entry === undefined) throw new Error("not seeded");
    await store.clear();
    expect(await store.write(entry, { devices: [] })).toBe("failed");
    await store.writeMeta({ owner: ids.ana, timezone: user.timezone, user });
    expect(await store.write(entry, { devices: [] })).toBe("failed");
    expect(await store.list()).toEqual([]);
  });

  it("finds the warm set by its index", async () => {
    const store = await openTestStore(freshIndexedDb());
    await seedEntry(store, { user, queryKey: queryKeys.devices, answer: { devices: [device()] } });
    await seedEntry(store, {
      user,
      queryKey: queryKeys.activity({ hours: 48, deviceIds: null }),
      answer: { from: "2026-10-26T12:00:00.000Z", to: "2026-10-28T12:00:00.000Z", buckets: [] },
    });
    const warm = await store.readWarm();
    expect(warm.map(({ entry }) => entry.resource)).toEqual(["devices"]);
  });

  it("touches an entry without rewriting its answer", async () => {
    const store = await openTestStore(freshIndexedDb());
    await seedEntry(store, {
      user,
      queryKey: queryKeys.devices,
      answer: { devices: [device()] },
      touchedAt: 1000,
      fetchedAt: 500,
    });
    await store.touch([{ key: devicesKey, touchedAt: 2000, fetchedAt: 1500, etag: 'W/"b"' }]);
    expect((await store.read(devicesKey))?.entry).toMatchObject({
      touchedAt: 2000,
      fetchedAt: 1500,
      etag: 'W/"b"',
    });
  });

  it("clears everything, the owner too", async () => {
    const store = await openTestStore(freshIndexedDb());
    await seedEntry(store, { user, queryKey: queryKeys.devices, answer: { devices: [device()] } });
    expect(await store.clear()).toBe(true);
    expect(await store.list()).toEqual([]);
    expect(await store.readMeta()).toBeNull();
  });

  it("is null without IndexedDB, or where the browser refuses it: the page keeps memory only", async () => {
    expect(await openCacheStore(undefined)).toBeNull();
    const refusing = {
      open: () => {
        throw new DOMException("refused", "SecurityError");
      },
    } as unknown as IDBFactory;
    expect(await openCacheStore(refusing)).toBeNull();
    const client = new QueryClient();
    const cache = createBrowserCache({
      on: true,
      openStore: () => Promise.resolve(null),
      channel: null,
    });
    attachBrowserCache(client, cache);
    await cache.signedIn(user);
    expect(cache.state()).toEqual({ on: true, available: false, owner: null });
    cache.dispose();
  });

  it("starts empty when the format changed (the database's version follows it)", async () => {
    const factory = freshIndexedDb();
    const store = await openTestStore(factory);
    await seedEntry(store, { user, queryKey: queryKeys.devices, answer: { devices: [device()] } });
    store.close();
    vi.resetModules();
    vi.doMock("../src/cache/cacheFormat", () => ({ cacheFormat: 2 }));
    const { openCacheStore: openNext } = await import("../src/cache/openCacheStore");
    const next = await openNext(factory);
    expect(next).not.toBeNull();
    expect(await next?.list()).toEqual([]);
    expect(await next?.readMeta()).toBeNull();
    next?.close();
    vi.doUnmock("../src/cache/cacheFormat");
  });

  it("a page of an older format keeps memory only once a newer one opened the store", async () => {
    const factory = freshIndexedDb();
    vi.resetModules();
    vi.doMock("../src/cache/cacheFormat", () => ({ cacheFormat: 3 }));
    const { openCacheStore: openNewer } = await import("../src/cache/openCacheStore");
    (await openNewer(factory))?.close();
    vi.doUnmock("../src/cache/cacheFormat");
    expect(await openCacheStore(factory)).toBeNull();
  });
});

describe("the copy when the browser runs out of room", () => {
  /** A store whose writes are refused for lack of room the first `refusals` times. */
  function crampedStore(store: CacheStore, refusals: number) {
    let left = refusals;
    const write = vi.fn(async (...args: Parameters<CacheStore["write"]>): Promise<WriteOutcome> => {
      if (left > 0) {
        left -= 1;
        return "quota";
      }
      return store.write(...args);
    });
    const list = vi.spyOn(store, "list");
    return { store: { ...store, write, list: () => list() } as CacheStore, write, list };
  }

  async function writeDevices(refusals: number) {
    const factory = freshIndexedDb();
    const inner = await openTestStore(factory);
    const cramped = crampedStore(inner, refusals);
    const client = new QueryClient();
    const cache = createBrowserCache({
      on: true,
      openStore: () => Promise.resolve(cramped.store),
      channel: null,
    });
    attachBrowserCache(client, cache);
    await cache.signedIn(user);
    client.setQueryData(queryKeys.devices, { devices: [device()] });
    cache.persistNow(queryKeys.devices);
    await settle(50);
    return { cache, inner, ...cramped };
  }

  it("sweeps to half the soft budget and writes again", async () => {
    const { cache, inner, write, list } = await writeDevices(1);
    expect(write).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalled();
    expect(await inner.read(devicesKey)).not.toBeNull();
    expect(cache.stats.get().memoryOnly).toBe(false);
    cache.dispose();
  });

  it("keeps memory only for the rest of the page load after a second refusal, never an error", async () => {
    const { cache, inner, write } = await writeDevices(2);
    expect(write).toHaveBeenCalledTimes(2);
    expect(await inner.read(devicesKey)).toBeNull();
    expect(cache.stats.get().memoryOnly).toBe(true);
    expect(cache.state().available).toBe(false);
    cache.dispose();
  });
});
