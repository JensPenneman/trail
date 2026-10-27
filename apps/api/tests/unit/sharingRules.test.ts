import type { ServerEvent } from "@trail/contracts/events";
import type { TransportMode } from "@trail/contracts/transport";
import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/appContext";
import type { TokenPrincipal, UserRow } from "../../src/auth/requestAuth";
import type { DeviceRow } from "../../src/devices/findOwnedDevice";
import { EventBus } from "../../src/events/eventBus";
import { mayReadPeople } from "../../src/sharing/accessibleDevices";
import { announceShareChange } from "../../src/sharing/announceShareChange";
import { cellMetres } from "../../src/sharing/gridProjection";
import { mayReadOwnLocations } from "../../src/sharing/mayReadOwnLocations";
import {
  assertShareableDevices,
  assertWithinTokenDevices,
} from "../../src/sharing/shareableDevices";
import { coversDevice, liveWindowMs, windowStart } from "../../src/sharing/shareWindow";
import { toSharedDevice } from "../../src/sharing/toSharedDevice";
import { haversineM } from "../../src/tracks/haversine";

const now = new Date("2026-10-26T12:00:00.000Z");
const hour = 3_600_000;
const user = { id: "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a60" } as UserRow;
const deviceId = "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3";
const other = "0199a0f3-5fec-72ad-a30c-5ab9d8908cd4";
const token = (scopes: TokenPrincipal["scopes"], deviceIds: string[] | null = null) =>
  ({
    kind: "token",
    user,
    tokenId: "t",
    tokenName: "Script",
    scopes,
    deviceIds,
  }) satisfies TokenPrincipal;
const session = { kind: "session" as const, user, sessionId: "s" };

const device = (changes: Partial<DeviceRow> = {}): DeviceRow => ({
  id: deviceId,
  userId: user.id,
  name: "Jens’s iPhone",
  source: "overland",
  deviceKey: "jens-iphone",
  tokenHash: "secret-hash",
  tokenHint: "abcd",
  alertsEnabled: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  lastSeenAt: new Date(now.getTime() - 60_000),
  lastRecordedAt: new Date(now.getTime() - 120_000),
  lastLat: 51.0543,
  lastLon: 3.7174,
  lastAccuracy: 6,
  lastSpeed: 5,
  lastAltitude: 10,
  lastCourse: 90,
  lastMotion: ["cycling"],
  batteryLevel: 0.81,
  batteryState: "unplugged",
  batteryRecordedAt: new Date(now.getTime() - 120_000),
  liveTrip: { mode: "bicycle", startedAt: "2026-10-26T11:00:00.000Z", distanceM: 4000 },
  pointsTotal: 1234,
  pendingSettings: "balanced",
  settingsAppliedAt: null,
  staleAlertedAt: null,
  ...changes,
});

const key = Buffer.alloc(32, 3);
const grant = (precision: "precise" | "approximate" | "area", includeDetails = true) => ({
  precision,
  includeDetails,
});

describe("share windows", () => {
  it("reach back the history, or the live window for live-only shares", () => {
    const live = liveWindowMs({ staleAfterHours: 12 });
    expect(live).toBe(12 * hour);
    expect(windowStart(null, now, live).toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(windowStart(7, now, live).toISOString()).toBe("2026-10-19T12:00:00.000Z");
  });

  it("cover the devices they name, or all of them", () => {
    expect(coversDevice(null, deviceId)).toBe(true);
    expect(coversDevice([deviceId], deviceId)).toBe(true);
    expect(coversDevice([other], deviceId)).toBe(false);
    expect(coversDevice([], deviceId)).toBe(false);
  });
});

describe("who may see what", () => {
  it("lets sessions and people:read tokens see people", () => {
    expect(mayReadPeople(session)).toBe(true);
    expect(mayReadPeople({ user })).toBe(true);
    expect(mayReadPeople(token(["people:read"]))).toBe(true);
    expect(mayReadPeople(token(["devices:read", "locations:read", "shares:read"]))).toBe(false);
  });

  it("measures distances from the viewer's own position only with locations:read", () => {
    expect(mayReadOwnLocations(session)).toBe(true);
    expect(mayReadOwnLocations(token(["people:read"]))).toBe(false);
    expect(mayReadOwnLocations(token(["people:read", "locations:read"]))).toBe(true);
  });

  it("makes a token limited to devices name the devices it shares", async () => {
    // "Every device" is refused before any lookup.
    const noDatabase = {} as Parameters<typeof assertShareableDevices>[0];
    const limited = token(["shares:write"], [deviceId]);
    await expect(assertShareableDevices(noDatabase, limited, null)).rejects.toMatchObject({
      status: 400,
      code: "validation_failed",
      fields: { deviceIds: [expect.any(String)] },
    });
    await expect(assertShareableDevices(noDatabase, session, null)).resolves.toBeUndefined();
    await expect(
      assertShareableDevices(noDatabase, token(["shares:write"]), null),
    ).resolves.toBeUndefined();
  });

  it("lets a token limited to devices change only shares within them", () => {
    const limited = token(["shares:write"], [deviceId]);
    expect(() => assertWithinTokenDevices(session, null)).not.toThrow();
    expect(() => assertWithinTokenDevices(token(["shares:write"]), [other])).not.toThrow();
    expect(() => assertWithinTokenDevices(limited, [deviceId])).not.toThrow();
    for (const deviceIds of [null, [deviceId, other], [other]]) {
      expect(() => assertWithinTokenDevices(limited, deviceIds)).toThrow(
        expect.objectContaining({ status: 403, code: "forbidden" }),
      );
    }
  });
});

describe("a device as a share shows it", () => {
  const from = new Date(now.getTime() - 12 * hour);
  const noModes = new Map<string, TransportMode>();

  it("names only what it may: no tokens, keys, settings, alerts or counts", () => {
    const shown = toSharedDevice(device(), grant("precise"), {
      key,
      from,
      viewerAt: null,
      modes: noModes,
    });
    expect(Object.keys(shown).sort()).toEqual([
      "activity",
      "battery",
      "distanceM",
      "id",
      "location",
      "name",
    ]);
    expect(JSON.stringify(shown)).not.toMatch(/secret-hash|abcd|jens-iphone|balanced|1234/);
    expect(shown.activity).toEqual({ motion: ["cycling"], tripMode: "bicycle", mode: null });
    expect(shown.battery).toMatchObject({ level: 0.81, state: "unplugged" });
  });

  it("shows battery and activity only with details", () => {
    const shown = toSharedDevice(device(), grant("precise", false), {
      key,
      from,
      viewerAt: null,
      modes: noModes,
    });
    expect(shown.battery).toBeNull();
    expect(shown.activity).toBeNull();
    expect(shown.location).not.toBeNull();
  });

  it("names the device's current transport mode with details only", () => {
    const modes = new Map<string, TransportMode>([[device().id, "train"]]);
    const context = { key, from, viewerAt: null, modes };
    expect(toSharedDevice(device(), grant("approximate"), context).activity?.mode).toBe("train");
    expect(toSharedDevice(device(), grant("approximate", false), context).activity).toBeNull();
    // Another device's mode is not this one's.
    const other = device({ id: "0199a0f3-5fec-72ad-a30c-5ab9d8908cd4" });
    expect(toSharedDevice(other, grant("precise"), context).activity?.mode).toBeNull();
  });

  it("shows nothing recorded before the share's window", () => {
    const old = device({
      lastRecordedAt: new Date(from.getTime() - 1000),
      batteryRecordedAt: new Date(from.getTime() - 1000),
    });
    const shown = toSharedDevice(old, grant("precise"), {
      key,
      from,
      viewerAt: null,
      modes: noModes,
    });
    expect(shown).toMatchObject({ location: null, battery: null, activity: null, distanceM: null });
  });

  it("never carries the precise position of an approximate or area share", () => {
    for (const precision of ["approximate", "area"] as const) {
      const shown = toSharedDevice(device(), grant(precision), {
        key,
        from,
        viewerAt: null,
        modes: noModes,
      });
      expect(shown.location?.lat).not.toBe(51.0543);
      expect(shown.location?.lon).not.toBe(3.7174);
      expect(shown.location?.accuracy).toBe(cellMetres(precision));
      expect(shown.location?.altitude).toBeNull();
    }
  });

  it("measures the distance to the shown position, not to the real one", () => {
    const viewerAt = { lat: 51.1, lon: 3.8 };
    const shown = toSharedDevice(device(), grant("area"), { key, from, viewerAt, modes: noModes });
    const location = shown.location;
    if (location === null) throw new Error("expected a location");
    expect(shown.distanceM).toBe(Math.round(haversineM(viewerAt, location)));
    expect(shown.distanceM).not.toBe(
      Math.round(haversineM(viewerAt, { lat: 51.0543, lon: 3.7174 })),
    );
  });
});

describe("share change events", () => {
  const owner = "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a61";
  const recipient = "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a62";
  const shareId = "019a2b4c-7d10-7e3a-9b21-5c8d0e6f1a23";

  function harness() {
    const bus = new EventBus();
    const received: Record<string, ServerEvent[]> = { [owner]: [], [recipient]: [] };
    for (const id of [owner, recipient]) {
      bus.subscribe(id, {
        sessionId: id,
        send: (event) => received[id]?.push(event),
        close: () => undefined,
      });
    }
    const forgotten: string[] = [];
    const ctx = { bus, sharing: { forget: (id: string) => forgotten.push(id) } };
    return { ctx: ctx as unknown as AppContext, received, forgotten };
  }

  it("tell the recipient about new, changed and stopped shares", () => {
    const { ctx, received, forgotten } = harness();
    for (const change of ["created", "updated", "revoked"] as const) {
      announceShareChange(ctx, { shareId, ownerId: owner, recipientId: recipient, change });
    }
    expect(received[recipient]).toEqual([
      { type: "share", shareId, userId: owner, change: "created" },
      { type: "share", shareId, userId: owner, change: "updated" },
      { type: "share", shareId, userId: owner, change: "revoked" },
    ]);
    expect(received[owner]).toEqual([]);
    expect(forgotten).toEqual([owner, owner, owner]);
  });

  it("tell the owner when the recipient hides them, shows them again or signs up", () => {
    const { ctx, received } = harness();
    for (const change of ["hidden", "unhidden", "claimed"] as const) {
      announceShareChange(ctx, { shareId, ownerId: owner, recipientId: recipient, change });
    }
    expect(received[owner]?.map((event) => event.type === "share" && event.change)).toEqual([
      "hidden",
      "unhidden",
      "claimed",
    ]);
    expect(received[recipient]).toEqual([]);
  });

  it("tell nobody about a pending share, but still drop the cache", () => {
    const { ctx, received, forgotten } = harness();
    announceShareChange(ctx, { shareId, ownerId: owner, recipientId: null, change: "created" });
    expect(received[owner]).toEqual([]);
    expect(received[recipient]).toEqual([]);
    expect(forgotten).toEqual([owner]);
  });
});
