import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { codecFor } from "../src/cache/cacheCodecs";
import { cacheValidators } from "../src/cache/cacheValidators";
import { encodeEntry } from "../src/cache/encodeEntry";
import type { StoredEntry } from "../src/cache/openCacheStore";
import { restoreWarmSet } from "../src/cache/restoreWarmSet";
import { automatic, car, device, ids, user } from "./support/fixtures";

const now = Date.now();
const expected = { owner: user.id, timezone: user.timezone, now };

async function stored(queryKey: readonly unknown[], answer: unknown, fetchedAt = now - 60_000) {
  const codec = await codecFor(queryKey);
  if (codec === null) throw new Error("no codec");
  const encoded = encodeEntry(
    { owner: user.id, timezone: user.timezone, queryKey, answer, fetchedAt, etag: 'W/"e"', now },
    codec,
  );
  if (encoded === null) throw new Error("refused");
  return { stored: { entry: encoded.entry, body: encoded.body } as StoredEntry, codec };
}

async function restore(client: QueryClient, entries: Awaited<ReturnType<typeof stored>>[]) {
  return restoreWarmSet(
    client,
    entries.map((entry) => entry.stored),
    expected,
    new Map(entries.map((entry) => [entry.stored.entry.key, entry.codec])),
  );
}

describe("restoreWarmSet", () => {
  it("puts the warm set into the cache with the time each answer was fetched, and its ETag", async () => {
    const client = new QueryClient();
    const devices = { devices: [device(), car()] };
    const result = await restore(client, [await stored(queryKeys.devices, devices, now - 90_000)]);
    expect(result.restored).toBe(1);
    expect(client.getQueryState(queryKeys.devices)).toMatchObject({
      data: devices,
      dataUpdatedAt: now - 90_000,
    });
    expect(cacheValidators.get(client, queryKeys.devices)).toBe('W/"e"');
  });

  it("restores the mode of the device that reported last only", async () => {
    const client = new QueryClient();
    await restore(client, [
      await stored(queryKeys.devices, { devices: [device(), car()] }),
      await stored(queryKeys.deviceMode(ids.phone), { mode: automatic }),
      await stored(queryKeys.deviceMode(ids.car), { mode: automatic }),
    ]);
    expect(client.getQueryData(queryKeys.deviceMode(ids.phone))).toEqual({ mode: automatic });
    expect(client.getQueryData(queryKeys.deviceMode(ids.car))).toBeUndefined();
  });

  it("leaves an answer the page already has when it is as new or newer", async () => {
    const client = new QueryClient();
    const fresh = { devices: [device({ name: "From the server" })] };
    client.setQueryData(queryKeys.devices, fresh, { updatedAt: now });
    const result = await restore(client, [await stored(queryKeys.devices, { devices: [] })]);
    expect(result.restored).toBe(0);
    expect(client.getQueryData(queryKeys.devices)).toBe(fresh);
  });

  it("restores nothing that is no longer current, and reports what failed", async () => {
    const client = new QueryClient();
    const yesterday = {
      from: new Date(now - 2 * 86_400_000).toISOString(),
      to: new Date(now - 86_400_000).toISOString(),
    };
    const past = await stored(queryKeys.tracks({ ...yesterday, deviceIds: null }), {
      ...yesterday,
      tracks: [],
    });
    // Written while it was today: warm then, not any more.
    past.stored.entry.warm = 1;
    const damaged = await stored(queryKeys.devices, { devices: [device()] });
    damaged.stored.body = { devices: [{ id: "not a device" }] };
    const result = await restore(client, [past, damaged]);
    expect(result.restored).toBe(0);
    expect(result.invalid).toEqual([damaged.stored.entry.key]);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});
