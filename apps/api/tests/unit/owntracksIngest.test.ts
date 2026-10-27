import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { owntracksToken } from "../../src/owntracks/owntracksToken";
import { prepareOwnTracks } from "../../src/owntracks/prepareOwnTracks";
import { readOwnTracksBody } from "../../src/owntracks/readOwnTracksBody";
import {
  owntracksAndroidLocation,
  owntracksIosLocation,
  owntracksTransition,
} from "../support/trackerSamples";

const receivedAt = new Date("2026-10-27T10:00:00.000Z");
const at = new Date("2026-10-27T09:59:30.000Z");
const token = "trl_Xq8vM2kPz7LtR4nW9cYb3hJd6fGs1aEe0uTiKoNpQrS";

const message = (value: unknown) => prepareOwnTracks({ kind: "message", value }, receivedAt);
const onlyLocation = (value: unknown) => {
  const { batch } = message(value);
  expect(batch.rejects).toEqual([]);
  expect(batch.locations).toHaveLength(1);
  const [location] = batch.locations;
  if (location === undefined) throw new Error("no location");
  return location;
};

describe("the OwnTracks body", () => {
  it("is empty, a message or kept as text that is no JSON", () => {
    expect(readOwnTracksBody(undefined)).toEqual({ kind: "empty" });
    expect(readOwnTracksBody(Buffer.from(""))).toEqual({ kind: "empty" });
    expect(readOwnTracksBody(Buffer.from(" \n"))).toEqual({ kind: "empty" });
    expect(readOwnTracksBody(Buffer.from('﻿{"_type":"lwt"}'))).toEqual({
      kind: "message",
      value: { _type: "lwt" },
    });
    expect(readOwnTracksBody(Buffer.from("{oops\u0000"))).toEqual({
      kind: "unreadable",
      preview: "{oops",
    });
  });
});

describe("OwnTracks locations", () => {
  it("reads Android's message: km/h, percent, battery status and the rest in extra", () => {
    const location = onlyLocation(owntracksAndroidLocation(at));
    expect(location).toMatchObject({
      recordedAt: at,
      lat: 51.0543,
      lon: 3.7174,
      altitude: 45,
      speed: 5,
      course: 271,
      horizontalAccuracy: 12,
      verticalAccuracy: 3,
      motion: [],
      batteryLevel: 0.76,
      batteryState: "unplugged",
      wifi: "Home Wi-Fi",
      battery: { recordedAt: at, level: 0.76, state: "unplugged" },
    });
    expect(location.extra).toEqual({
      _id: "a1b2c3d4",
      created_at: seconds(at) + 2,
      t: "u",
      m: 2,
      conn: "w",
      inregions: ["Home"],
      BSSID: "aa:bb:cc:dd:ee:ff",
      tid: "P8",
      source: "fused",
      topic: "owntracks/pixel-8-k3f9/pixel-8-k3f9",
    });
  });

  it("reads iOS's message: motion activity, Wi-Fi in lower case, pressure kept", () => {
    const location = onlyLocation(owntracksIosLocation(at));
    expect(location).toMatchObject({
      speed: 5 / 3.6,
      motion: ["walking"],
      wifi: "Office",
      batteryState: "charging",
      batteryLevel: 0.55,
    });
    expect(location.extra).toMatchObject({ p: 101.325, bssid: "11:22:33:44:55:66", inrids: [] });
  });

  it("takes a speed of 0 from iOS and leaves out what Android did not send", () => {
    expect(onlyLocation(owntracksIosLocation(at, { vel: 0 })).speed).toBe(0);
    const bare = onlyLocation({
      _type: "location",
      lat: 51.05,
      lon: 3.72,
      tst: at.getTime() / 1000,
      tid: "P8",
    });
    expect(bare).toMatchObject({
      altitude: null,
      speed: null,
      course: null,
      horizontalAccuracy: null,
      verticalAccuracy: null,
      batteryLevel: null,
      batteryState: null,
      wifi: null,
      battery: null,
    });
  });

  it("drops iOS's altitude of a fix without one (0 and no vertical accuracy)", () => {
    const { vac: _vac, ...noVertical } = owntracksIosLocation(at, { alt: 0 });
    expect(onlyLocation(noVertical).altitude).toBeNull();
    expect(onlyLocation(owntracksIosLocation(at, { alt: 0, vac: 3 })).altitude).toBe(0);
    expect(onlyLocation(owntracksIosLocation(at, { alt: -2 })).altitude).toBe(-2);
  });

  it("keeps a battery level only from 0 to 100 percent, and a status only from 0 to 3", () => {
    expect(onlyLocation(owntracksAndroidLocation(at, { batt: 101 })).batteryLevel).toBeNull();
    expect(onlyLocation(owntracksAndroidLocation(at, { batt: -1 })).batteryLevel).toBeNull();
    expect(onlyLocation(owntracksAndroidLocation(at, { bs: 0 })).batteryState).toBe("unknown");
    expect(onlyLocation(owntracksAndroidLocation(at, { bs: 3 })).batteryState).toBe("full");
    expect(onlyLocation(owntracksAndroidLocation(at, { bs: 4 })).batteryState).toBeNull();
    expect(onlyLocation(owntracksAndroidLocation(at, { bs: "2" })).batteryState).toBeNull();
  });

  it("rejects positions and times that cannot be right, and says why", () => {
    const reasons = [
      owntracksAndroidLocation(at, { lat: 0, lon: 0 }),
      owntracksAndroidLocation(at, { lat: 91 }),
      owntracksAndroidLocation(at, { lon: "3.72" }),
      owntracksAndroidLocation(at, { tst: undefined }),
      owntracksAndroidLocation(at, { tst: "yesterday" }),
      owntracksAndroidLocation(at, { tst: at.getTime() }),
      owntracksAndroidLocation(at, { tst: 500_000_000 }),
    ].map((value) => message(value).batch.rejects.map((reject) => reject.reason));
    expect(reasons).toEqual([
      ["coordinates are exactly 0,0"],
      ["coordinates out of range"],
      ["invalid coordinates"],
      ["missing tst"],
      ["invalid tst"],
      ["timestamp is more than 24 h in the future"],
      ["timestamp is before 1990"],
    ]);
  });
});

describe("other OwnTracks messages", () => {
  it("turns region transitions into events, one per region", () => {
    const enter = message(owntracksTransition(at, "enter", "Home")).batch;
    expect(enter.records).toBe(1);
    expect(enter.events).toEqual([
      {
        recordedAt: at,
        action: "region_enter:rid-home",
        lat: 51.0543,
        lon: 3.7174,
        extra: {
          acc: 10,
          tid: "JP",
          event: "enter",
          t: "c",
          desc: "Home",
          wtst: 1_700_000_000,
          rid: "rid-home",
          topic: "owntracks/jens/iphone/event",
        },
        battery: null,
      },
    ]);
    const { rid: _rid, ...withoutRid } = owntracksTransition(at, "leave", "Garden");
    expect(message(withoutRid).batch.events[0]?.action).toBe("region_leave:Garden");
    const { lat: _lat, lon: _lon, ...noPosition } = owntracksTransition(at, "leave");
    expect(message(noPosition).batch.events[0]).toMatchObject({ lat: null, lon: null });
    expect(message({ ...owntracksTransition(at, "enter"), event: "dwell" }).batch.rejects).toEqual([
      expect.objectContaining({ reason: "transition without enter or leave" }),
    ]);
  });

  it("records a last will as an event", () => {
    expect(message({ _type: "lwt", tst: seconds(at) }).batch.events).toEqual([
      { recordedAt: at, action: "lwt", lat: null, lon: null, extra: null, battery: null },
    ]);
  });

  it("acknowledges waypoints, status, cards, commands, beacons and steps without storing them", () => {
    for (const type of ["waypoint", "waypoints", "status", "cmd", "card", "beacon", "steps"]) {
      const { batch } = message({ _type: type, tst: seconds(at), desc: "Home", lat: 51, lon: 3 });
      expect(batch, type).toMatchObject({ records: 1, locations: [], events: [], rejects: [] });
    }
  });

  it("never keeps a configuration dump, which holds the token as its password", () => {
    const dump = {
      _type: "dump",
      configuration: { _type: "configuration", password: token, encryptionKey: "s3cret" },
    };
    for (const value of [dump, dump.configuration]) {
      const prepared = message(value);
      expect(prepared.batch).toMatchObject({ records: 1, rejects: [], locations: [], events: [] });
      expect(JSON.stringify(prepared)).not.toContain(token);
    }
  });

  it("keeps what it cannot read in the dead letter, without credentials", () => {
    const reasons = (value: unknown) =>
      message(value).batch.rejects.map((reject) => [reject.reason, reject.record]);
    expect(reasons({ _type: "encrypted", data: "c2VjcmV0" })).toEqual([
      [
        "encrypted message: turn off encryption in OwnTracks",
        { _type: "encrypted", data: "c2VjcmV0" },
      ],
    ]);
    expect(reasons({ _type: "tour", password: token, note: `id=${token}` })).toEqual([
      ['unknown _type "tour"', { _type: "tour", note: "id=[redacted]" }],
    ]);
    expect(reasons({ lat: 51, lon: 3 })).toEqual([["message without _type", { lat: 51, lon: 3 }]]);
    expect(reasons([1, 2])).toEqual([["message is not a JSON object", [1, 2]]]);
    expect(
      prepareOwnTracks({ kind: "unreadable", preview: "lat=51" }, receivedAt).batch.rejects,
    ).toEqual([{ reason: "body is not JSON", record: { body: "lat=51" } }]);
    expect(prepareOwnTracks({ kind: "empty" }, receivedAt).batch.records).toBe(0);
  });
});

describe("the OwnTracks token", () => {
  const request = (authorization?: string) =>
    ({ get: (name: string) => (name === "authorization" ? authorization : undefined) }) as Request;
  const basic = (user: string, password: string) =>
    `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

  it("is the Basic password whatever the user name, or a bearer token", () => {
    expect(owntracksToken(request(basic("pixel-8-k3f9", token)))).toBe(token);
    expect(owntracksToken(request(basic("", token)))).toBe(token);
    expect(owntracksToken(request(`bAsIc ${Buffer.from(`x:${token}`).toString("base64")}`))).toBe(
      token,
    );
    expect(owntracksToken(request(`Bearer ${token}`))).toBe(token);
  });

  it("is missing for anything else, which costs no lookup", () => {
    expect(owntracksToken(request())).toBeNull();
    expect(owntracksToken(request(basic(token, "hunter2")))).toBeNull();
    expect(owntracksToken(request(`Basic ${token}`))).toBeNull();
    expect(owntracksToken(request("Basic not*base64"))).toBeNull();
    expect(owntracksToken(request(`Digest ${token}`))).toBeNull();
  });
});

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
