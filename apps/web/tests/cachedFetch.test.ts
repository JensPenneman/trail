import { onlineManager, QueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { deviceListResponseSchema } from "@trail/contracts/device";
import { tracksResponseSchema } from "@trail/contracts/track";
import { deviceModeResponseSchema } from "@trail/contracts/transport";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../src/api/ApiError";
import { apiFetch } from "../src/api/apiFetch";
import { queryKeys } from "../src/api/queryKeys";
import { cachedFetch } from "../src/cache/cachedFetch";
import { cacheValidators } from "../src/cache/cacheValidators";
import { dayStamp, device, ids, tracks, user } from "./support/fixtures";
import { mockApi } from "./support/mockApi";

const context = (client: QueryClient, queryKey: readonly unknown[]) => ({
  client,
  queryKey,
  signal: new AbortController().signal,
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("cachedFetch", () => {
  it("asks without a validator while nothing is on screen, and keeps the answer's ETag", async () => {
    const { calls } = mockApi({
      "GET /api/devices": { status: 200, body: { devices: [device()] }, etag: 'W/"one"' },
    });
    const client = new QueryClient();
    const answer = await cachedFetch(
      context(client, queryKeys.devices),
      apiPaths.devices.root,
      deviceListResponseSchema,
    );
    expect(answer.devices).toHaveLength(1);
    expect(calls[0]?.headers?.["if-none-match"]).toBeUndefined();
    expect(cacheValidators.get(client, queryKeys.devices)).toBe('W/"one"');
  });

  it("sends If-None-Match with the answer on screen, and a 304 keeps it", async () => {
    const { calls } = mockApi({
      "GET /api/devices": { status: 200, body: { devices: [] }, etag: 'W/"one"' },
    });
    const client = new QueryClient();
    const shown = { devices: [device({ name: "On screen" })] };
    client.setQueryData(queryKeys.devices, shown);
    cacheValidators.set(client, queryKeys.devices, 'W/"one"');
    const answer = await cachedFetch(
      context(client, queryKeys.devices),
      apiPaths.devices.root,
      deviceListResponseSchema,
    );
    expect(calls[0]?.headers?.["if-none-match"]).toBe('W/"one"');
    expect(calls[0]?.status).toBe(304);
    expect(answer).toBe(shown);
  });

  it("bumps when the answer was fetched when the server confirms it (a query's 304)", async () => {
    mockApi({ "GET /api/devices": { status: 200, body: { devices: [] }, etag: 'W/"one"' } });
    const client = new QueryClient();
    const shown = { devices: [device()] };
    client.setQueryData(queryKeys.devices, shown, { updatedAt: 1000 });
    cacheValidators.set(client, queryKeys.devices, 'W/"one"');
    await client.fetchQuery({
      queryKey: queryKeys.devices,
      queryFn: ({ client: own, queryKey, signal }) =>
        cachedFetch(
          { client: own, queryKey, signal },
          apiPaths.devices.root,
          deviceListResponseSchema,
        ),
    });
    const state = client.getQueryState(queryKeys.devices);
    expect(state?.data).toBe(shown);
    expect(state?.dataUpdatedAt).toBeGreaterThan(Date.now() - 5000);
  });

  it("takes a new answer and its new ETag when the server has one", async () => {
    mockApi({
      "GET /api/devices": {
        status: 200,
        body: { devices: [device({ name: "New" })] },
        etag: 'W/"two"',
      },
    });
    const client = new QueryClient();
    client.setQueryData(queryKeys.devices, { devices: [] });
    cacheValidators.set(client, queryKeys.devices, 'W/"one"');
    const answer = await cachedFetch(
      context(client, queryKeys.devices),
      apiPaths.devices.root,
      deviceListResponseSchema,
    );
    expect(answer.devices[0]?.name).toBe("New");
    expect(cacheValidators.get(client, queryKeys.devices)).toBe('W/"two"');
  });

  it("calls a 304 it did not ask for invalid_response, as apiFetch does", async () => {
    mockApi({ "GET /api/devices": { status: 304 } });
    const client = new QueryClient();
    await expect(
      cachedFetch(
        context(client, queryKeys.devices),
        apiPaths.devices.root,
        deviceListResponseSchema,
      ),
    ).rejects.toMatchObject({ code: "invalid_response", status: 304 });
    await expect(apiFetch(apiPaths.devices.root, deviceListResponseSchema)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("never sends a validator for an answer that does not revalidate (the mode, the feed)", async () => {
    const { calls } = mockApi({
      [`GET /api/v1/devices/${ids.phone}/mode`]: {
        status: 200,
        body: { mode: { current: null, override: null } },
        etag: 'W/"m"',
      },
    });
    const client = new QueryClient();
    const key = queryKeys.deviceMode(ids.phone);
    client.setQueryData(key, { mode: { current: null, override: null } });
    cacheValidators.set(client, key, 'W/"m"');
    await cachedFetch(
      context(client, key),
      apiPaths.v1.devices.mode(ids.phone),
      deviceModeResponseSchema,
    );
    expect(calls[0]?.headers?.["if-none-match"]).toBeUndefined();
  });

  it("asks nothing while the browser is offline: the query's retries wait for the network", async () => {
    const { calls } = mockApi({ "GET /api/devices": { status: 200, body: { devices: [] } } });
    const client = new QueryClient();
    onlineManager.setOnline(false);
    const failure = await cachedFetch(
      context(client, queryKeys.devices),
      apiPaths.devices.root,
      deviceListResponseSchema,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ code: "network", status: 0 });
    expect(calls).toHaveLength(0);
  });

  it("asks nothing for a past day whose stamps the calendar's fresh digest still has", async () => {
    const { calls } = mockApi({});
    const client = new QueryClient();
    client.setQueryData(queryKeys.session, user);
    const from = "2026-10-25T23:00:00.000Z";
    const to = "2026-10-26T23:00:00.000Z";
    const key = queryKeys.tracks({ from, to, deviceIds: null });
    const shown = { ...tracks(from, to), stamps: [dayStamp(ids.phone, "2026-10-26", "r1", "p1")] };
    client.setQueryData(key, shown);
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
          stamp: { raw: "r1", processed: "p9" },
        },
      ],
    });
    const answer = await cachedFetch(context(client, key), apiPaths.tracks, tracksResponseSchema, {
      query: { from, to, deviceIds: null },
    });
    expect(answer).toBe(shown);
    expect(calls).toHaveLength(0);
  });
});
