import { describe, expect, it } from "vitest";
import type { DeviceRow } from "../../src/devices/findOwnedDevice";
import {
  cellMetres,
  gridCellCentre,
  gridDegrees,
  ownerGridOffset,
  projectPosition,
  publicDeviceKey,
  type RecordedPosition,
} from "../../src/sharing/gridProjection";
import { toSharedDevice } from "../../src/sharing/toSharedDevice";
import { haversineM } from "../../src/tracks/haversine";

const key = Buffer.alloc(32, 7);
const owner = "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a60";
const otherOwner = "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a61";
const linkA = "019a2b4c-7d10-7e3a-9b21-5c8d0e6f1a23";
const linkB = "019a2b4c-7d10-7e3a-9b21-5c8d0e6f1a24";
const device = "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3";
const ghent = { lat: 51.0543, lon: 3.7174 };

const recorded = (lat: number, lon: number, extra: Partial<RecordedPosition> = {}) => ({
  lat,
  lon,
  accuracy: 8,
  recordedAt: new Date("2026-10-26T08:41:07.000Z"),
  speed: 4.2,
  course: 87,
  altitude: 12,
  ...extra,
});

/** A deterministic pseudo-random sequence, so failures can be reproduced. */
function* randoms(seed: number): Generator<number> {
  let state = seed;
  for (;;) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    yield state / 2_147_483_648;
  }
}

const next = (random: Generator<number>): number => random.next().value ?? 0;

describe("grid offsets", () => {
  it("are one per owner: the same for every share, link and device of theirs", () => {
    expect(ownerGridOffset(key, owner)).toEqual(ownerGridOffset(key, owner));
    expect(ownerGridOffset(key, otherOwner)).not.toEqual(ownerGridOffset(key, owner));
  });

  it("follow from the server's secret key, not from the ids alone", () => {
    expect(ownerGridOffset(Buffer.alloc(32, 8), owner)).not.toEqual(ownerGridOffset(key, owner));
  });

  it("are fractions of a cell", () => {
    const random = randoms(1);
    for (let index = 0; index < 200; index += 1) {
      const offset = ownerGridOffset(key, String(next(random)));
      for (const value of [offset.lat, offset.lon]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
  });
});

describe("approximate and area positions", () => {
  const offset = ownerGridOffset(key, owner);

  it("give the same answer for the same position, read after read", () => {
    const first = projectPosition(recorded(ghent.lat, ghent.lon), "approximate", offset);
    for (let read = 0; read < 50; read += 1) {
      expect(projectPosition(recorded(ghent.lat, ghent.lon), "approximate", offset)).toEqual(first);
    }
  });

  it("give one centre for a phone that jitters in place, so averaging reads gains nothing", () => {
    const random = randoms(2);
    const answers = new Set<string>();
    for (let read = 0; read < 2000; read += 1) {
      // ±10 m of GPS noise around one spot.
      const lat = ghent.lat + (next(random) - 0.5) * 0.00018;
      const lon = ghent.lon + (next(random) - 0.5) * 0.00028;
      const answer = projectPosition(recorded(lat, lon), "approximate", offset);
      answers.add(`${answer.lat},${answer.lon}`);
    }
    // At most the corners of four cells meet within 20 m: never a cloud to average.
    expect(answers.size).toBeLessThanOrEqual(4);
    for (const answer of answers) {
      const [lat = 0, lon = 0] = answer.split(",").map(Number);
      // Every answer is a cell centre, which maps onto itself.
      expect(gridCellCentre(lat, lon, "approximate", offset)).toEqual({ lat, lon });
    }
  });

  it("stay within the cell around the real position, anywhere on the globe", () => {
    const random = randoms(3);
    for (const precision of ["approximate", "area"] as const) {
      const size = gridDegrees[precision];
      for (let index = 0; index < 3000; index += 1) {
        const lat = (next(random) - 0.5) * 170;
        const lon = (next(random) - 0.5) * 359.9;
        const answer = projectPosition(recorded(lat, lon), precision, offset);
        expect(Math.abs(answer.lat - lat)).toBeLessThanOrEqual(size / 2 + 1e-6);
        // Half a cell north–south and half a cell east–west at most: within the cell's diagonal.
        expect(haversineM({ lat, lon }, answer)).toBeLessThanOrEqual(
          cellMetres(precision) * Math.SQRT1_2 * 1.01 + 1,
        );
      }
    }
  });

  it("are about as wide as they are high, at every latitude", () => {
    for (const lat of [0, 51.05, 70]) {
      const centre = gridCellCentre(lat, 10, "approximate", offset);
      const east = gridCellCentre(
        centre.lat,
        centre.lon + gridDegrees.approximate / Math.cos((centre.lat * Math.PI) / 180),
        "approximate",
        offset,
      );
      expect(haversineM(centre, east)).toBeCloseTo(cellMetres("approximate"), -1);
    }
  });

  it("make every area cell an exact block of approximate cells", () => {
    const random = randoms(4);
    for (let index = 0; index < 500; index += 1) {
      const lat = (next(random) - 0.5) * 140;
      const lon = (next(random) - 0.5) * 359.9;
      const area = gridCellCentre(lat, lon, "area", offset);
      // Every position of the same approximate cell lies in the same area cell.
      const approximate = gridCellCentre(lat, lon, "approximate", offset);
      for (const [dLat, dLon] of [
        [0.0024, 0.0024],
        [-0.0024, -0.0024],
        [0.0024, -0.0024],
        [-0.0024, 0.0024],
      ] as const) {
        const inside = { lat: approximate.lat + dLat, lon: approximate.lon + dLon * 0.5 };
        expect(gridCellCentre(inside.lat, inside.lon, "approximate", offset)).toEqual(approximate);
        expect(gridCellCentre(inside.lat, inside.lon, "area", offset)).toEqual(area);
      }
    }
  });

  it("keep the cell at the antimeridian whole", () => {
    // Lines at half a cell: the cell around the antimeridian reaches half a cell either side of it.
    const middle = { lat: 0.3, lon: 0.5 };
    const east = gridCellCentre(10, 179.999, "approximate", middle);
    const west = gridCellCentre(10, -179.999, "approximate", middle);
    expect(west).toEqual(east);
    expect(gridCellCentre(10, 179.999, "area", middle)).toEqual(
      gridCellCentre(10, -179.999, "area", middle),
    );
    for (const lon of [179.9999, -179.9999]) {
      const answer = projectPosition(recorded(10, lon), "area", offset);
      expect(answer.lon).toBeGreaterThanOrEqual(-180);
      expect(answer.lon).toBeLessThan(180);
      expect(haversineM({ lat: 10, lon }, answer)).toBeLessThan(cellMetres("area"));
    }
    for (const lat of [89.999, -89.999]) {
      expect(Math.abs(projectPosition(recorded(lat, 3), "area", offset).lat)).toBeLessThanOrEqual(
        90,
      );
    }
  });

  it("report the cell as accuracy, or the fix's own when it is worse", () => {
    expect(cellMetres("approximate")).toBe(556);
    expect(cellMetres("area")).toBe(5560);
    expect(projectPosition(recorded(ghent.lat, ghent.lon), "approximate", offset).accuracy).toBe(
      556,
    );
    expect(
      projectPosition(recorded(ghent.lat, ghent.lon, { accuracy: 1500 }), "approximate", offset)
        .accuracy,
    ).toBe(1500);
    expect(projectPosition(recorded(ghent.lat, ghent.lon), "area", offset).accuracy).toBe(5560);
  });

  it("leave out what would narrow them down: altitude and course, and the speed for areas", () => {
    const approximate = projectPosition(recorded(ghent.lat, ghent.lon), "approximate", offset);
    expect(approximate).toMatchObject({ speed: 4.2, course: null, altitude: null });
    const area = projectPosition(recorded(ghent.lat, ghent.lon), "area", offset);
    expect(area).toMatchObject({ speed: null, course: null, altitude: null, precision: "area" });
    expect(area.recordedAt).toBe("2026-10-26T08:41:07.000Z");
  });
});

describe("everything one owner shares, held together", () => {
  const row = (id: string, lat: number, lon: number): DeviceRow => ({
    id,
    userId: owner,
    name: id,
    source: "overland",
    deviceKey: id,
    tokenHash: id,
    tokenHint: "abcd",
    alertsEnabled: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    lastSeenAt: new Date("2026-10-26T08:41:07Z"),
    lastRecordedAt: new Date("2026-10-26T08:41:07Z"),
    lastLat: lat,
    lastLon: lon,
    lastAccuracy: 5,
    lastSpeed: 1,
    lastAltitude: 10,
    lastCourse: 90,
    lastMotion: [],
    batteryLevel: null,
    batteryState: null,
    batteryRecordedAt: null,
    liveTrip: null,
    pointsTotal: 0,
    pendingSettings: null,
    settingsAppliedAt: null,
    staleAlertedAt: null,
  });
  const context = { key, from: new Date("2026-10-26T00:00:00Z"), viewerAt: null, modes: new Map() };

  // Thousands of projections per trial: a busy machine needs more than the default 5 s.
  it("never narrows a position below one approximate cell", { timeout: 60_000 }, () => {
    const random = randoms(5);
    for (let trial = 0; trial < 25; trial += 1) {
      const lat = (next(random) - 0.5) * 120;
      const lon = (next(random) - 0.5) * 359.9;
      // Up to four devices in one pocket, each through several shares and links of both precisions.
      const devices = Array.from({ length: 1 + Math.floor(next(random) * 4) }, (_, index) =>
        String(index),
      );
      const grants = Array.from({ length: 2 + Math.floor(next(random) * 6) }, () => ({
        precision: next(random) < 0.5 ? ("approximate" as const) : ("area" as const),
        includeDetails: false,
      }));
      const view = (at: { lat: number; lon: number }, id: string, index: number) => {
        const grant = grants[index] ?? { precision: "approximate" as const, includeDetails: false };
        const shown = toSharedDevice(row(id, at.lat, at.lon), grant, context);
        return `${shown.location?.lat},${shown.location?.lon}`;
      };
      const truth = devices.map((id) => grants.map((_, index) => view({ lat, lon }, id, index)));
      /** Whether a candidate shows exactly what the real position shows, in every view. */
      const consistent = (candidate: { lat: number; lon: number }) =>
        devices.every((id, d) =>
          grants.every((_, index) => view(candidate, id, index) === truth[d]?.[index]),
        );
      // Every candidate position that shows the same in every view could be the real one.
      const height = gridDegrees.approximate;
      const width = height / Math.cos((lat * Math.PI) / 180);
      const steps = 30;
      let [south, north, west, east] = [0, 0, 0, 0];
      for (let i = -steps; i <= steps; i += 1) {
        for (let j = -steps; j <= steps; j += 1) {
          const dLat = (i / steps) * 1.5 * height;
          const dLon = (j / steps) * 1.5 * width;
          if (!consistent({ lat: lat + dLat, lon: ((lon + dLon + 540) % 360) - 180 })) continue;
          south = Math.min(south, dLat);
          north = Math.max(north, dLat);
          west = Math.min(west, dLon);
          east = Math.max(east, dLon);
        }
      }
      const step = (1.5 * height) / steps;
      expect(north - south, `rows at ${lat},${lon}`).toBeGreaterThanOrEqual(height - 2 * step);
      expect(east - west, `columns at ${lat},${lon}`).toBeGreaterThanOrEqual(
        width * 0.99 - 2 * step * (width / height),
      );
    }
  });

  it("gives other owners grids of their own", () => {
    const mine = projectPosition(
      recorded(ghent.lat, ghent.lon),
      "approximate",
      ownerGridOffset(key, owner),
    );
    const theirs = projectPosition(
      recorded(ghent.lat, ghent.lon),
      "approximate",
      ownerGridOffset(key, otherOwner),
    );
    expect(theirs).not.toEqual(mine);
  });
});

describe("device keys of public pages", () => {
  it("are stable for a link, differ between links and never are the device id", () => {
    const first = publicDeviceKey(key, linkA, device);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(publicDeviceKey(key, linkA, device)).toBe(first);
    expect(publicDeviceKey(key, linkB, device)).not.toBe(first);
    expect(device.replaceAll("-", "")).not.toContain(first);
  });
});

describe("precise positions", () => {
  it("pass through untouched", () => {
    expect(
      projectPosition(recorded(ghent.lat, ghent.lon), "precise", ownerGridOffset(key, owner)),
    ).toEqual({
      lat: ghent.lat,
      lon: ghent.lon,
      accuracy: 8,
      recordedAt: "2026-10-26T08:41:07.000Z",
      speed: 4.2,
      course: 87,
      altitude: 12,
      precision: "precise",
    });
  });
});
