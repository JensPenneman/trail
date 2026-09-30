import { QueryClient } from "@tanstack/react-query";
import type { DeviceListResponse, DeviceResponse } from "@trail/contracts/device";
import type { TracksResponse } from "@trail/contracts/track";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { applyServerEvent } from "../src/live/applyServerEvent";
import { createLiveStore } from "../src/live/createLiveStore";
import { car, device, ids, tracks } from "./support/fixtures";

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
