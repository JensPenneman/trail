import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { apiPaths } from "@trail/contracts/apiPaths";
import { ingestLogResponseSchema } from "@trail/contracts/ingestLog";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { createQueryClient } from "../src/app/createQueryClient";
import { attachBrowserCache } from "../src/cache/attachBrowserCache";
import type { BrowserCache } from "../src/cache/browserCache";
import { cachedFetch } from "../src/cache/cachedFetch";
import { removeDeviceFromCache } from "../src/devices/removeDeviceFromCache";
import { applyServerEvent } from "../src/live/applyServerEvent";
import { createLiveStore } from "../src/live/createLiveStore";
import { useDeleteAccount } from "../src/queries/useDeleteAccount";
import { useSignOut } from "../src/queries/useSignOut";
import { useUpdateProfile } from "../src/queries/useUpdateProfile";
import {
  freshIndexedDb,
  openTestStore,
  seedEntry,
  settle,
  testCache,
} from "./support/cacheHarness";
import { car, device, ids, tracks, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";

const caches: BrowserCache[] = [];
const channels: BroadcastChannel[] = [];
afterEach(() => {
  for (const cache of caches.splice(0)) cache.dispose();
  for (const channel of channels.splice(0)) channel.close();
  window.localStorage.clear();
});

const today = { from: "2026-10-27T23:00:00.000Z", to: "2026-10-28T23:00:00.000Z" };
const month = { from: "2026-10-01", to: "2026-10-31" };

/** A store holding the owner's devices, today's phone track, the month and a car-only answer. */
async function filledStore() {
  const factory = freshIndexedDb();
  const store = await openTestStore(factory);
  await seedEntry(store, {
    user,
    queryKey: queryKeys.devices,
    answer: { devices: [device(), car()] },
  });
  await seedEntry(store, {
    user,
    queryKey: queryKeys.tracks({ ...today, deviceIds: [ids.phone] }),
    answer: tracks(today.from, today.to),
  });
  await seedEntry(store, {
    user,
    queryKey: queryKeys.days({ ...month, deviceIds: null }),
    answer: { timezone: user.timezone, days: [] },
  });
  await seedEntry(store, {
    user,
    queryKey: queryKeys.activity({ hours: 48, deviceIds: [ids.car] }),
    answer: { from: today.from, to: today.to, buckets: [] },
  });
  return { factory, store };
}

async function signedIn(
  client: QueryClient,
  factory: ReturnType<typeof freshIndexedDb>,
  channel?: BroadcastChannel,
) {
  const cache = testCache(factory, channel === undefined ? {} : { channel });
  caches.push(cache);
  attachBrowserCache(client, cache);
  await cache.signedIn(user);
  client.setQueryData(queryKeys.session, user);
  return cache;
}

/** The providers a hook of the app needs: the query client and a router. */
const wrapper =
  (client: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RouterProvider router={createMemoryRouter([{ path: "*", element: children }])} />
    </QueryClientProvider>
  );

/** `fetch` that answers only when the test says so. */
function holdRequests() {
  let answer: (response: Response) => void = () => undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    ),
  );
  return () => answer(new Response(JSON.stringify({ ok: true }), { status: 200 }));
}

describe("the purges of the copy on disk", () => {
  it("signing out empties it before the request goes", async () => {
    const { factory, store } = await filledStore();
    const client = new QueryClient();
    await signedIn(client, factory);
    const answer = holdRequests();
    const { result } = renderHook(() => useSignOut(), { wrapper: wrapper(client) });
    act(() => result.current.mutate());
    await expect.poll(() => store.list()).toEqual([]);
    expect(await store.readMeta()).toBeNull();
    answer();
  });

  it("deleting the account empties it before the request goes", async () => {
    const { factory, store } = await filledStore();
    const client = new QueryClient();
    await signedIn(client, factory);
    const answer = holdRequests();
    const { result } = renderHook(() => useDeleteAccount(), { wrapper: wrapper(client) });
    act(() => result.current.mutate({ confirmEmail: user.email }));
    await expect.poll(() => store.list()).toEqual([]);
    answer();
  });

  it("a lost session — a 401 from any request — empties it", async () => {
    const { factory, store } = await filledStore();
    const cache = testCache(factory);
    caches.push(cache);
    const client = createQueryClient(cache);
    await cache.signedIn(user);
    client.setQueryData(queryKeys.session, user);
    const unauthorized = { error: { code: "unauthorized", message: "Gone" } };
    mockApi({ [`GET /api/devices/${ids.phone}/ingest-log`]: { status: 401, body: unauthorized } });
    await client
      .fetchQuery({
        queryKey: queryKeys.ingestLog(ids.phone, 20),
        queryFn: ({ client: own, queryKey, signal }) =>
          cachedFetch(
            { client: own, queryKey, signal },
            apiPaths.devices.ingestLog(ids.phone),
            ingestLogResponseSchema,
          ),
        retry: false,
      })
      .catch(() => undefined);
    expect(client.getQueryData(queryKeys.session)).toBeNull();
    await expect.poll(() => store.list()).toEqual([]);
  });

  it("the session-ended event empties it", async () => {
    const { factory, store } = await filledStore();
    const client = new QueryClient();
    const cache = await signedIn(client, factory);
    applyServerEvent(client, createLiveStore(), { type: "session-ended" });
    await expect.poll(() => store.list()).toEqual([]);
    expect(cache.state().owner).toBeNull();
  });

  it("another account empties it before anything is restored", async () => {
    const { factory, store } = await filledStore();
    const client = new QueryClient();
    const cache = testCache(factory);
    caches.push(cache);
    attachBrowserCache(client, cache);
    cache.prepare();
    await cache.signedIn({ ...user, id: ids.ana, email: "ana@example.com" });
    expect(client.getQueryData(queryKeys.devices)).toBeUndefined();
    expect(await store.list()).toEqual([]);
    expect((await store.readMeta())?.owner).toBe(ids.ana);
  });

  it("a new time zone removes the answers about local days, and keeps the rest", async () => {
    const { factory, store } = await filledStore();
    const client = new QueryClient();
    await signedIn(client, factory);
    mockApi({
      "PATCH /api/me": { status: 200, body: { user: { ...user, timezone: "Europe/Lisbon" } } },
    });
    const { result } = renderHook(() => useUpdateProfile(), { wrapper: wrapper(client) });
    await act(() => result.current.mutateAsync({ timezone: "Europe/Lisbon" }));
    await expect
      .poll(async () => (await store.list()).map((entry) => entry.resource).sort())
      .toEqual(["activity", "devices"]);
    expect((await store.readMeta())?.timezone).toBe("Europe/Lisbon");
  });

  it("turning the toggle off empties it and writes nothing more", async () => {
    const { factory, store } = await filledStore();
    const client = new QueryClient();
    const cache = await signedIn(client, factory);
    await cache.setOn(false);
    expect(await store.list()).toEqual([]);
    expect(window.localStorage.getItem("trail.cache")).toBe("off");
    client.setQueryData(queryKeys.devices, { devices: [device()] });
    cache.persistNow(queryKeys.devices);
    await settle(50);
    expect(await store.list()).toEqual([]);
    await cache.setOn(true);
    expect(window.localStorage.getItem("trail.cache")).toBeNull();
    cache.persistNow(queryKeys.devices);
    await expect.poll(async () => (await store.list()).length).toBe(1);
  });

  it("a deleted device takes every entry that may hold its data with it", async () => {
    const { factory, store } = await filledStore();
    const client = new QueryClient();
    await signedIn(client, factory);
    removeDeviceFromCache(client, ids.phone);
    // The car-only activity stays; the lists of all devices and the phone's track go.
    await expect
      .poll(async () => (await store.list()).map((entry) => entry.resource))
      .toEqual(["activity"]);
  });

  it("tells the other tabs, which write nothing for the owner from then on", async () => {
    const { factory, store } = await filledStore();
    const name = `trail-cache-test-${Math.random()}`;
    const first = new BroadcastChannel(name);
    const second = new BroadcastChannel(name);
    channels.push(first, second);
    const one = new QueryClient();
    const other = new QueryClient();
    const tab = await signedIn(one, factory, first);
    const otherTab = await signedIn(other, factory, second);
    expect(otherTab.state().owner).toBe(user.id);
    await tab.purge("sign-out");
    await expect.poll(() => otherTab.state().owner).toBeNull();
    other.setQueryData(queryKeys.devices, { devices: [device()] });
    otherTab.persistNow(queryKeys.devices);
    await settle(50);
    expect(await store.list()).toEqual([]);
  });
});

describe("the copy across offline paints and other tabs", () => {
  it("binds the copy for real once the probe answers after an offline paint", async () => {
    const { factory, store } = await filledStore();
    // Untouched for over a week: the start-up sweep removes it.
    await seedEntry(store, {
      user,
      queryKey: queryKeys.ingestLog(ids.phone, 50),
      answer: { entries: [] },
      touchedAt: Date.now() - 8 * 86_400_000,
    });
    const client = new QueryClient();
    const cache = testCache(factory);
    caches.push(cache);
    attachBrowserCache(client, cache);
    cache.prepare();
    const offlineUser = await cache.offlineUser();
    if (offlineUser === null) throw new Error("no copy to paint from");
    await cache.paintOffline(offlineUser);
    const renamed = { ...user, displayName: "Jens P." };
    await cache.signedIn(renamed);
    expect((await store.readMeta())?.user.displayName).toBe("Jens P.");
    await expect
      .poll(async () => (await store.list()).map((entry) => entry.resource), { timeout: 5000 })
      .not.toContain("ingest-log");
  });

  it("forgets the answers of the account another tab signed out when another one signs in", async () => {
    const { factory } = await filledStore();
    const name = `trail-cache-test-${Math.random()}`;
    const first = new BroadcastChannel(name);
    const second = new BroadcastChannel(name);
    channels.push(first, second);
    const one = new QueryClient();
    const other = new QueryClient();
    const tab = await signedIn(one, factory, first);
    const otherTab = await signedIn(other, factory, second);
    other.setQueryData(queryKeys.devices, { devices: [device()] });
    await tab.purge("sign-out");
    await expect.poll(() => otherTab.state().owner).toBeNull();
    await otherTab.signedIn({ ...user, id: ids.ana, email: "ana@example.com" });
    expect(other.getQueryData(queryKeys.devices)).toBeUndefined();
  });
});
