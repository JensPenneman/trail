import { describe, expect, it } from "vitest";
import { queryKeys } from "../src/api/queryKeys";
import { codecFor } from "../src/cache/cacheCodecs";
import { cacheFormat } from "../src/cache/cacheFormat";
import { decodeEntry } from "../src/cache/decodeEntry";
import { encodeEntry } from "../src/cache/encodeEntry";
import { config, dayStamp, device, ids, levelTracks, tracks, user } from "./support/fixtures";

const now = Date.parse("2026-10-28T12:00:00.000Z");
const from = "2026-10-25T23:00:00.000Z";
const to = "2026-10-26T23:00:00.000Z";
const expected = { owner: user.id, timezone: "Europe/Brussels", now };

async function encoded(
  queryKey: readonly unknown[],
  answer: unknown,
  timezone = "Europe/Brussels",
) {
  const codec = await codecFor(queryKey);
  if (codec === null) throw new Error("no codec");
  const result = encodeEntry(
    { owner: user.id, timezone, queryKey, answer, fetchedAt: now - 60_000, etag: 'W/"a"', now },
    codec,
  );
  if (result === null) throw new Error("refused");
  return { ...result, codec };
}

describe("encodeEntry and decodeEntry", () => {
  it("give back exactly what apiFetch handed the app, the points packed in between", async () => {
    const answer = { ...tracks(from, to), stamps: [dayStamp(ids.phone, "2026-10-26")] };
    const queryKey = queryKeys.tracks({ from, to, deviceIds: null });
    const { entry, body, codec } = await encoded(queryKey, answer);
    const packed = (body as { tracks: { points: unknown }[] }).tracks[0]?.points;
    expect(packed).toMatchObject({ n: 3, width: 6 });
    expect(entry).toMatchObject({
      format: cacheFormat,
      owner: user.id,
      resource: "tracks",
      etag: 'W/"a"',
      stamps: answer.stamps,
      until: Date.parse(to),
      warm: 0,
      expiresAt: null,
    });
    expect(decodeEntry(entry, body, expected, codec)).toEqual({ ok: true, answer });
  });

  it("packs the points of level tracks too", async () => {
    const answer = levelTracks(from, to, "inferred");
    const queryKey = queryKeys.levelTracks({ from, to, deviceIds: null, level: "inferred" });
    const { entry, body, codec } = await encoded(queryKey, answer);
    expect(decodeEntry(entry, body, expected, codec)).toEqual({ ok: true, answer });
  });

  it("puts today and the account's own lists into the warm set, with today's end of life", async () => {
    const todayFrom = "2026-10-27T23:00:00.000Z";
    const todayTo = "2026-10-28T23:00:00.000Z";
    const today = await encoded(
      queryKeys.tracks({ from: todayFrom, to: todayTo, deviceIds: null }),
      tracks(todayFrom, todayTo),
    );
    expect(today.entry.warm).toBe(1);
    expect(today.entry.expiresAt).toBe(Date.parse(todayTo) + 7 * 86_400_000);
    expect((await encoded(queryKeys.devices, { devices: [device()] })).entry.warm).toBe(1);
    expect((await encoded(queryKeys.config, config)).entry.warm).toBe(1);
    const month = await encoded(
      queryKeys.days({ from: "2026-10-01", to: "2026-10-31", deviceIds: null }),
      { timezone: "Europe/Brussels", days: [] },
    );
    expect(month.entry.warm).toBe(1);
    const year = await encoded(
      queryKeys.days({ from: "2025-09-24", to: "2026-10-28", deviceIds: null }),
      { timezone: "Europe/Brussels", days: [] },
    );
    expect(year.entry.warm).toBe(0);
  });

  it("drops an answer the contract no longer allows", async () => {
    const queryKey = queryKeys.devices;
    const { entry, codec } = await encoded(queryKey, { devices: [device()] });
    expect(decodeEntry(entry, { devices: [{ id: "not a device" }] }, expected, codec)).toEqual({
      ok: false,
      failure: "schema",
    });
  });

  it("drops a packed body that is not what the codec made", async () => {
    const queryKey = queryKeys.tracks({ from, to, deviceIds: null });
    const { entry, codec } = await encoded(queryKey, tracks(from, to));
    const damaged = {
      ...tracks(from, to),
      tracks: [{ points: { packed: new ArrayBuffer(3), n: 1 } }],
    };
    expect(decodeEntry(entry, damaged, expected, codec)).toEqual({ ok: false, failure: "damaged" });
  });

  it("drops another owner's, another zone's, another format's and an expired entry", async () => {
    const queryKey = queryKeys.tracks({ from, to, deviceIds: null });
    const { entry, body, codec } = await encoded(queryKey, tracks(from, to));
    expect(decodeEntry(entry, body, { ...expected, owner: ids.ana }, codec)).toEqual({
      ok: false,
      failure: "owner",
    });
    expect(decodeEntry(entry, body, { ...expected, timezone: "Europe/Lisbon" }, codec)).toEqual({
      ok: false,
      failure: "zone",
    });
    expect(decodeEntry({ ...entry, format: cacheFormat + 1 }, body, expected, codec)).toEqual({
      ok: false,
      failure: "format",
    });
    expect(decodeEntry(entry, body, { ...expected, now: now + 91 * 86_400_000 }, codec)).toEqual({
      ok: false,
      failure: "expired",
    });
  });

  it("keeps answers that are not about local days whatever the zone", async () => {
    const { entry, body, codec } = await encoded(queryKeys.devices, { devices: [device()] });
    expect(decodeEntry(entry, body, { ...expected, timezone: "Asia/Tokyo" }, codec).ok).toBe(true);
  });

  it("refuses to write what the policy does not list", async () => {
    expect(await codecFor(queryKeys.people)).toBeNull();
    expect(await codecFor(queryKeys.personTracksOf(ids.ana))).toBeNull();
    expect(
      await codecFor(
        queryKeys.accessLog({
          actor: null,
          channel: null,
          action: null,
          from: null,
          actorId: null,
        }),
      ),
    ).toBeNull();
    const codec = await codecFor(queryKeys.devices);
    if (codec === null) throw new Error("no codec");
    expect(
      encodeEntry(
        {
          owner: user.id,
          timezone: "UTC",
          queryKey: queryKeys.people,
          answer: { people: [] },
          fetchedAt: now,
          etag: null,
          now,
        },
        codec,
      ),
    ).toBeNull();
  });
});
