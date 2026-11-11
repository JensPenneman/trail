import { describe, expect, it } from "vitest";
import type { Executor } from "../../src/db/database";
import { RegionCoverageStore } from "../../src/processing/regionCoverageStore";

const square = (west: number, south: number, east: number, north: number) => ({
  type: "MultiPolygon" as const,
  coordinates: [
    [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  ],
});

interface Region {
  source: string;
  updated_at: string;
  polygon: ReturnType<typeof square>;
}

/** An executor that answers the store's two statements from a list of ready regions, and counts them. */
function fakeDatabase(ready: Region[]) {
  const asked = { state: 0, polygons: 0 };
  const db = {
    execute: async (query: unknown) => {
      const withPolygons = JSON.stringify(query).includes("polygon");
      if (withPolygons) asked.polygons += 1;
      else asked.state += 1;
      return {
        rows: ready.map((region) =>
          withPolygons ? region : { source: region.source, updated_at: region.updated_at },
        ),
      };
    },
  };
  return { db: db as unknown as Executor, asked };
}

// One z14 tile around (4.4 E, 50.85 N) lies well inside this square.
const inside = "14/8397/5505";
const around = square(4.0, 50.5, 5.0, 51.2);

describe("RegionCoverageStore", () => {
  it("asks for the polygons only when the ready builds change", async () => {
    const ready: Region[] = [
      { source: "belgium@1", updated_at: "2026-11-01 10:00:00+00", polygon: around },
    ];
    const { db, asked } = fakeDatabase(ready);
    const store = new RegionCoverageStore();
    const first = await store.current(db);
    expect(first.covers(inside)).toBe(true);
    expect(asked).toEqual({ state: 1, polygons: 1 });
    const second = await store.current(db);
    expect(second).toBe(first);
    expect(asked).toEqual({ state: 2, polygons: 1 });

    // A re-import: the same region, newer.
    ready[0] = {
      source: "belgium@1",
      updated_at: "2026-11-02 10:00:00+00",
      polygon: square(10, 10, 11, 11),
    };
    const third = await store.current(db);
    expect(third).not.toBe(first);
    expect(third.covers(inside)).toBe(false);
    expect(asked).toEqual({ state: 3, polygons: 2 });
  });

  it("covers nothing without a ready region, and reads no polygon for it", async () => {
    const ready: Region[] = [];
    const { db, asked } = fakeDatabase(ready);
    const store = new RegionCoverageStore();
    expect((await store.current(db)).covers(inside)).toBe(false);
    expect(asked).toEqual({ state: 1, polygons: 0 });
    ready.push({ source: "belgium@1", updated_at: "x", polygon: around });
    expect((await store.current(db)).covers(inside)).toBe(true);
    ready.length = 0; // dropped meanwhile
    expect((await store.current(db)).covers(inside)).toBe(false);
  });
});
