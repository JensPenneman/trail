import { describe, expect, it } from "vitest";
import {
  cellMetres,
  gridCellCentre,
  gridDegrees,
  gridOffset,
  projectPosition,
  type RecordedPosition,
} from "../../src/sharing/gridProjection";
import { haversineM } from "../../src/tracks/haversine";

const key = Buffer.alloc(32, 7);
const shareA = "019a2b4c-7d10-7e3a-9b21-5c8d0e6f1a23";
const shareB = "019a2b4c-7d10-7e3a-9b21-5c8d0e6f1a24";
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

describe("grid offsets", () => {
  it("are the same for the same share and device, every time", () => {
    expect(gridOffset(key, "share", shareA, device)).toEqual(
      gridOffset(key, "share", shareA, device),
    );
  });

  it("differ between shares, devices and links of the same device", () => {
    const offsets = [
      gridOffset(key, "share", shareA, device),
      gridOffset(key, "share", shareB, device),
      gridOffset(key, "share", shareA, "0199a0f3-5fec-72ad-a30c-5ab9d8908cd4"),
      gridOffset(key, "link", shareA, device),
    ];
    expect(new Set(offsets.map((offset) => `${offset.lat}/${offset.lon}`)).size).toBe(4);
  });

  it("follow from the server's secret key, not from the ids alone", () => {
    expect(gridOffset(Buffer.alloc(32, 8), "share", shareA, device)).not.toEqual(
      gridOffset(key, "share", shareA, device),
    );
  });

  it("are fractions of a cell", () => {
    const random = randoms(1);
    for (let index = 0; index < 200; index += 1) {
      const offset = gridOffset(key, "share", String(random.next().value), device);
      for (const value of [offset.lat, offset.lon]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
  });
});

describe("approximate and area positions", () => {
  const offset = gridOffset(key, "share", shareA, device);

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
      const lat = ghent.lat + ((random.next().value ?? 0) - 0.5) * 0.00018;
      const lon = ghent.lon + ((random.next().value ?? 0) - 0.5) * 0.00028;
      const answer = projectPosition(recorded(lat, lon), "approximate", offset);
      answers.add(`${answer.lat},${answer.lon}`);
    }
    // At most the corners of four cells meet within 20 m: never a cloud to average.
    expect(answers.size).toBeLessThanOrEqual(4);
    for (const answer of answers) {
      const [lat = 0, lon = 0] = answer.split(",").map(Number);
      // Every answer is a cell centre, which maps onto itself.
      expect(gridCellCentre(lat, lon, gridDegrees.approximate, offset)).toEqual({ lat, lon });
    }
  });

  it("stay within the cell around the real position, anywhere on the globe", () => {
    const random = randoms(3);
    for (const precision of ["approximate", "area"] as const) {
      const size = gridDegrees[precision];
      for (let index = 0; index < 3000; index += 1) {
        const lat = ((random.next().value ?? 0) - 0.5) * 170;
        const lon = ((random.next().value ?? 0) - 0.5) * 359.9;
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
      const centre = gridCellCentre(lat, 10, gridDegrees.approximate, offset);
      const width = gridDegrees.approximate / Math.cos((centre.lat * Math.PI) / 180);
      const east = gridCellCentre(centre.lat, centre.lon + width, gridDegrees.approximate, offset);
      expect(haversineM(centre, east)).toBeCloseTo(cellMetres("approximate"), -1);
    }
  });

  it("move only when the phone leaves its cell", () => {
    const start = projectPosition(recorded(ghent.lat, ghent.lon), "area", offset);
    const nearby = projectPosition(recorded(ghent.lat + 0.0001, ghent.lon), "area", offset);
    expect(nearby).toEqual(start);
    const far = projectPosition(recorded(ghent.lat + 0.2, ghent.lon), "area", offset);
    expect(far.lat).not.toBe(start.lat);
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

  it("differ between two shares of the same position", () => {
    const other = gridOffset(key, "share", shareB, device);
    expect(projectPosition(recorded(ghent.lat, ghent.lon), "approximate", other)).not.toEqual(
      projectPosition(recorded(ghent.lat, ghent.lon), "approximate", offset),
    );
  });

  it("wrap at the antimeridian and stay on the globe at the poles", () => {
    for (const lon of [179.9999, -179.9999]) {
      const answer = projectPosition(recorded(10, lon), "area", offset);
      expect(answer.lon).toBeGreaterThanOrEqual(-180);
      expect(answer.lon).toBeLessThan(180);
      expect(haversineM({ lat: 10, lon }, answer)).toBeLessThan(cellMetres("area"));
    }
    for (const lat of [89.999, -89.999]) {
      const answer = projectPosition(recorded(lat, 3), "area", offset);
      expect(Math.abs(answer.lat)).toBeLessThanOrEqual(90);
    }
  });
});

describe("precise positions", () => {
  it("pass through untouched", () => {
    const offset = gridOffset(key, "share", shareA, device);
    expect(projectPosition(recorded(ghent.lat, ghent.lon), "precise", offset)).toEqual({
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
