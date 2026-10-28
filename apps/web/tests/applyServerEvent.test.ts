import { QueryClient } from "@tanstack/react-query";
import type { DeviceListResponse, DeviceResponse } from "@trail/contracts/device";
import type { PeopleResponse } from "@trail/contracts/person";
import type { TracksResponse } from "@trail/contracts/track";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { applyServerEvent } from "../src/live/applyServerEvent";
import { createLiveStore } from "../src/live/createLiveStore";
import { localDayRange } from "../src/time/localDayRange";
import { ana, bob, car, device, ids, sharedDevice, tracks } from "./support/fixtures";

const range = { from: "2026-09-29T22:00:00.000Z", to: "2026-09-30T22:00:00.000Z" };
const inRange = Date.parse("2026-09-30T10:00:00.000Z") / 1000;

function setup() {
  const queryClient = new QueryClient();
  const store = createLiveStore();
  queryClient.setQueryData<DeviceListResponse>(queryKeys.devices, { devices: [device(), car()] });
  return { queryClient, store };
}

describe("applyServerEvent", () => {
  it("replaces a changed device in the list and detail caches", () => {
    const { queryClient, store } = setup();
    applyServerEvent(queryClient, store, { type: "device", device: device({ name: "Renamed" }) });
    const list = queryClient.getQueryData<DeviceListResponse>(queryKeys.devices);
    expect(list?.devices.map((entry) => entry.name)).toEqual(["Renamed", "Car"]);
    expect(queryClient.getQueryData<DeviceResponse>(queryKeys.device(ids.phone))?.device.name).toBe(
      "Renamed",
    );
  });

  it("adds a device it did not know yet", () => {
    const { queryClient, store } = setup();
    const added = device({ id: "01926f40-4a71-7c93-a465-7f8091a2b3c4", name: "Tablet" });
    applyServerEvent(queryClient, store, { type: "device", device: added });
    expect(queryClient.getQueryData<DeviceListResponse>(queryKeys.devices)?.devices).toHaveLength(
      3,
    );
  });

  it("signs the page out when the server ends the session", () => {
    const { queryClient, store } = setup();
    queryClient.setQueryData(queryKeys.session, { id: "signed-in" });
    applyServerEvent(queryClient, store, { type: "session-ended" });
    expect(queryClient.getQueryData(queryKeys.session)).toBeNull();
  });

  it("forgets a removed device", () => {
    const { queryClient, store } = setup();
    queryClient.setQueryData<DeviceResponse>(queryKeys.device(ids.car), { device: car() });
    applyServerEvent(queryClient, store, { type: "device-removed", deviceId: ids.car });
    expect(
      queryClient
        .getQueryData<DeviceListResponse>(queryKeys.devices)
        ?.devices.map((entry) => entry.id),
    ).toEqual([ids.phone]);
    expect(queryClient.getQueryData(queryKeys.device(ids.car))).toBeUndefined();
  });

  it("appends uploaded points to every cached track range that covers them", () => {
    const { queryClient, store } = setup();
    const today = queryKeys.tracks({ ...range, deviceIds: null });
    const carOnly = queryKeys.tracks({ ...range, deviceIds: [ids.car] });
    queryClient.setQueryData<TracksResponse>(today, tracks(range.from, range.to));
    queryClient.setQueryData<TracksResponse>(carOnly, { ...range, tracks: [] });

    applyServerEvent(queryClient, store, {
      type: "ingest",
      deviceId: ids.phone,
      receivedAt: "2026-09-30T10:00:05.000Z",
      inserted: 2,
      duplicates: 0,
      rejected: 0,
      points: [
        [3.6, 51.0, inRange, 12, 9, 10],
        [3.61, 51.01, inRange + 30, 12, 480, 10],
      ],
    });

    const phoneTrack = queryClient
      .getQueryData<TracksResponse>(today)
      ?.tracks.find((track) => track.deviceId === ids.phone);
    // The second point is less accurate than the server's 200 m filter and stays out.
    expect(phoneTrack?.points.at(-1)?.[2]).toBe(inRange);
    expect(phoneTrack?.total).toBe(4);
    expect(queryClient.getQueryData<TracksResponse>(carOnly)?.tracks).toEqual([]);
    expect(store.getSnapshot().uploads[0]).toMatchObject({ deviceId: ids.phone, inserted: 2 });
  });

  it("marks Insights for refetching when processing finished a window", () => {
    const { queryClient, store } = setup();
    const params = { from: "2026-10-20", to: "2026-10-26", deviceIds: null, mode: null };
    queryClient.setQueryData(queryKeys.insightsOverview(params), { pending: true });
    queryClient.setQueryData(queryKeys.insightsTime(params), { pending: true });
    applyServerEvent(queryClient, store, {
      type: "segments",
      deviceId: ids.phone,
      from: "2026-10-26T06:00:00.000Z",
      to: "2026-10-26T09:00:00.000Z",
    });
    expect(queryClient.getQueryState(queryKeys.insightsOverview(params))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.insightsTime(params))?.isInvalidated).toBe(true);
  });

  it("marks the activity chart for refetching after an upload", () => {
    const { queryClient, store } = setup();
    const key = queryKeys.activity({ hours: 48, deviceIds: null });
    queryClient.setQueryData(key, { from: range.from, to: range.to, buckets: [] });
    applyServerEvent(queryClient, store, {
      type: "ingest",
      deviceId: ids.phone,
      receivedAt: "2026-09-30T10:00:05.000Z",
      inserted: 0,
      duplicates: 3,
      rejected: 0,
      points: [],
    });
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  });
});

describe("applyServerEvent for people", () => {
  function withPeople() {
    const queryClient = new QueryClient();
    const store = createLiveStore();
    queryClient.setQueryData<PeopleResponse>(queryKeys.people, { people: [ana(), bob()] });
    return { queryClient, store };
  }

  it("moves a person's device where the event says", () => {
    const { queryClient, store } = withPeople();
    const others = queryClient.getQueryData<PeopleResponse>(queryKeys.people)?.people[1];
    const moved = sharedDevice({ distanceM: 20 });
    applyServerEvent(queryClient, store, { type: "person", userId: ids.ana, device: moved });
    const people = queryClient.getQueryData<PeopleResponse>(queryKeys.people)?.people;
    expect(people?.[0]?.devices).toEqual([moved]);
    expect(people?.[1]).toBe(others);
  });

  it("refetches that person's track, nobody else's", () => {
    const { queryClient, store } = withPeople();
    const params = { from: "a", to: "b", deviceIds: [ids.anaPhone], share: "s:7" };
    const hers = queryKeys.personTracks(ids.ana, params);
    const his = queryKeys.personTracks(ids.bob, { ...params, deviceIds: [ids.bobPhone] });
    queryClient.setQueryData(hers, { cached: true });
    queryClient.setQueryData(his, { cached: true });
    applyServerEvent(queryClient, store, {
      type: "person",
      userId: ids.ana,
      device: sharedDevice(),
    });
    expect(queryClient.getQueryState(hers)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(his)?.isInvalidated).toBe(false);
  });

  it("adds a device the person did not share before", () => {
    const { queryClient, store } = withPeople();
    const watch = sharedDevice({ id: "01926f3c-2e5f-7a71-8243-5d6e7f8091a9", name: "Watch" });
    applyServerEvent(queryClient, store, { type: "person", userId: ids.ana, device: watch });
    expect(
      queryClient.getQueryData<PeopleResponse>(queryKeys.people)?.people[0]?.devices,
    ).toHaveLength(2);
  });

  it("refetches the list for someone it does not know yet", async () => {
    const { queryClient, store } = withPeople();
    applyServerEvent(queryClient, store, {
      type: "person",
      userId: "01926f3a-8b2c-7d4e-9f10-2a3b4c5d6e99",
      device: sharedDevice(),
    });
    expect(queryClient.getQueryState(queryKeys.people)?.isInvalidated).toBe(true);
  });

  it("drops a stopped share's person at once, and tells about new ones", () => {
    const { queryClient, store } = withPeople();
    applyServerEvent(queryClient, store, {
      type: "share",
      shareId: ids.bobShare,
      userId: ids.bob,
      change: "created",
    });
    expect(store.getSnapshot().shareNotices.map((notice) => notice.shareId)).toEqual([
      ids.bobShare,
    ]);
    applyServerEvent(queryClient, store, {
      type: "share",
      shareId: ids.bobShare,
      userId: ids.bob,
      change: "revoked",
    });
    expect(
      queryClient.getQueryData<PeopleResponse>(queryKeys.people)?.people.map((p) => p.userId),
    ).toEqual([ids.ana]);
    expect(store.getSnapshot().shareNotices).toEqual([]);
    for (const queryKey of [queryKeys.people, queryKeys.shares, queryKeys.incomingShares]) {
      queryClient.setQueryData(queryKey, queryClient.getQueryData(queryKey) ?? { shares: [] });
    }
    applyServerEvent(queryClient, store, {
      type: "share",
      shareId: ids.anaShare,
      userId: ids.ana,
      change: "hidden",
    });
    expect(queryClient.getQueryState(queryKeys.shares)?.isInvalidated).toBe(true);
  });

  it("refreshes distances when one's own device moves", () => {
    const { queryClient, store } = withPeople();
    applyServerEvent(queryClient, store, { type: "device", device: device() });
    expect(queryClient.getQueryState(queryKeys.people)?.isInvalidated).toBe(true);
  });
});

describe("applyServerEvent for the copy and the digest", () => {
  const owner = {
    id: ids.user,
    email: "jens@example.com",
    displayName: "Jens",
    isAdmin: true,
    timezone: "Europe/Brussels",
    createdAt: "2026-03-02T19:20:11.000Z",
    preferences: { mapStyle: "auto", level: "inferred", showOwnActivity: false },
  } as const;
  const monthKey = queryKeys.days({ from: "2026-10-01", to: "2026-10-31", deviceIds: null });
  const row = (deviceId: string, date: string, points: number, raw: string) => ({
    date,
    deviceId,
    points,
    distanceM: points * 10,
    firstAt: `${date}T06:00:00.000Z`,
    lastAt: `${date}T18:00:00.000Z`,
    stamp: { raw, processed: null },
  });
  const day = (date: string) => localDayRange(date, date, "Europe/Brussels");

  function withDigest() {
    const { queryClient, store } = setup();
    queryClient.setQueryData(queryKeys.session, owner);
    queryClient.setQueryData(
      monthKey,
      {
        timezone: "Europe/Brussels",
        days: [
          row(ids.phone, "2026-10-24", 100, "a"),
          row(ids.car, "2026-10-24", 50, "c"),
          row(ids.phone, "2026-10-25", 80, "b"),
        ],
      },
      { updatedAt: 1000 },
    );
    return { queryClient, store };
  }

  it("learns from hello whether the server tells of every change to the daily statistics", () => {
    const { queryClient, store } = setup();
    applyServerEvent(queryClient, store, { type: "hello", serverTime: new Date().toISOString() });
    expect(store.getSnapshot()).toMatchObject({ versions: null, sendsDays: false });
    const versions = { averaged: 2, mapped: 3, inferred: 4 };
    applyServerEvent(queryClient, store, {
      type: "hello",
      serverTime: new Date().toISOString(),
      versions,
    });
    expect(store.getSnapshot()).toMatchObject({ versions, sendsDays: true });
  });

  it("updates the month's digest in place with the rows a days event carries", () => {
    const { queryClient, store } = withDigest();
    applyServerEvent(queryClient, store, {
      type: "days",
      deviceId: ids.phone,
      // the 24th grew, the 25th lost its last point, the 26th got its first
      dates: ["2026-10-24", "2026-10-25", "2026-10-26"],
      days: [row(ids.phone, "2026-10-24", 120, "a2"), row(ids.phone, "2026-10-26", 5, "d")],
    });
    const state = queryClient.getQueryState(monthKey);
    expect(state?.data).toEqual({
      timezone: "Europe/Brussels",
      days: [
        row(ids.phone, "2026-10-24", 120, "a2"),
        row(ids.car, "2026-10-24", 50, "c"),
        row(ids.phone, "2026-10-26", 5, "d"),
      ].sort((a, b) =>
        a.date === b.date ? (a.deviceId < b.deviceId ? -1 : 1) : a.date < b.date ? -1 : 1,
      ),
    });
    // No newer than it was: the rest of it was not confirmed.
    expect(state?.dataUpdatedAt).toBe(1000);
    expect(store.getSnapshot().sendsDays).toBe(true);
  });

  it("leaves digests alone that cover other devices or other days", () => {
    const { queryClient, store } = withDigest();
    const carOnly = queryKeys.days({ from: "2026-10-01", to: "2026-10-31", deviceIds: [ids.car] });
    const september = queryKeys.days({ from: "2026-09-01", to: "2026-09-30", deviceIds: null });
    const carDigest = { timezone: "Europe/Brussels", days: [row(ids.car, "2026-10-24", 50, "c")] };
    queryClient.setQueryData(carOnly, carDigest);
    queryClient.setQueryData(september, { timezone: "Europe/Brussels", days: [] });
    applyServerEvent(queryClient, store, {
      type: "days",
      deviceId: ids.phone,
      dates: ["2026-10-24"],
      days: [row(ids.phone, "2026-10-24", 120, "a2")],
    });
    expect(queryClient.getQueryData(carOnly)).toBe(carDigest);
    expect(queryClient.getQueryState(september)?.isInvalidated).toBe(false);
  });

  it("marks stale the answers of the days it names, of that device, and no others", () => {
    const { queryClient, store } = withDigest();
    const named = queryKeys.tracks({ ...day("2026-10-24"), deviceIds: null });
    const otherDay = queryKeys.tracks({ ...day("2026-10-23"), deviceIds: null });
    const otherDevice = queryKeys.visits({ ...day("2026-10-24"), deviceIds: [ids.car] });
    const timeline = queryKeys.timeline({ ...day("2026-10-24"), deviceIds: [ids.phone] });
    for (const key of [named, otherDay, otherDevice, timeline]) queryClient.setQueryData(key, {});
    applyServerEvent(queryClient, store, {
      type: "days",
      deviceId: ids.phone,
      dates: ["2026-10-24"],
      days: [row(ids.phone, "2026-10-24", 120, "a2")],
    });
    expect(queryClient.getQueryState(named)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(timeline)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherDay)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(otherDevice)?.isInvalidated).toBe(false);
  });

  it("stops marking every digest stale on uploads once the server sends days events", () => {
    const { queryClient, store } = withDigest();
    const upload = {
      type: "ingest" as const,
      deviceId: ids.phone,
      receivedAt: "2026-10-26T10:00:05.000Z",
      inserted: 1,
      duplicates: 0,
      rejected: 0,
      points: [],
    };
    applyServerEvent(queryClient, store, upload);
    expect(queryClient.getQueryState(monthKey)?.isInvalidated).toBe(true);
    const { queryClient: newer, store: newerStore } = withDigest();
    newerStore.setServer({ sendsDays: true });
    applyServerEvent(newer, newerStore, upload);
    expect(newer.getQueryState(monthKey)?.isInvalidated).toBe(false);
  });

  it("marks stale only the levels, timelines and Insights a processing window touched", () => {
    const { queryClient, store } = withDigest();
    const inside = queryKeys.levelTracks({
      ...day("2026-10-26"),
      deviceIds: null,
      level: "inferred",
    });
    const before = queryKeys.levelTracks({
      ...day("2026-10-20"),
      deviceIds: null,
      level: "inferred",
    });
    const carOnly = queryKeys.timeline({ ...day("2026-10-26"), deviceIds: [ids.car] });
    const timeline = queryKeys.timeline({ ...day("2026-10-26"), deviceIds: [ids.phone] });
    const rawTracks = queryKeys.tracks({ ...day("2026-10-26"), deviceIds: null });
    const recent = queryKeys.insightsOverview({
      from: "2026-10-20",
      to: null,
      deviceIds: null,
      mode: null,
    });
    const lastMonth = queryKeys.insightsOverview({
      from: "2026-09-01",
      to: "2026-09-30",
      deviceIds: null,
      mode: null,
    });
    const mode = queryKeys.deviceMode(ids.phone);
    for (const key of [inside, before, carOnly, timeline, rawTracks, recent, lastMonth, mode]) {
      queryClient.setQueryData(key, {});
    }
    applyServerEvent(queryClient, store, {
      type: "segments",
      deviceId: ids.phone,
      from: "2026-10-26T06:00:00.000Z",
      to: "2026-10-26T09:00:00.000Z",
    });
    const invalidated = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;
    expect(invalidated(inside)).toBe(true);
    expect(invalidated(timeline)).toBe(true);
    expect(invalidated(recent)).toBe(true);
    expect(invalidated(mode)).toBe(true);
    expect(invalidated(before)).toBe(false);
    expect(invalidated(carOnly)).toBe(false);
    expect(invalidated(rawTracks)).toBe(false);
    expect(invalidated(lastMonth)).toBe(false);
  });
});
