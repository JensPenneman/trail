import {
  heatCellCeiling,
  heatmapQuerySchema,
  heatmapResponseSchema,
} from "@trail/contracts/heatmap";
import { describe, expect, it } from "vitest";
import { heatCellCap, viewCells } from "../../src/heatmap/heatCellCap";
import { latToTileY, lonToTileX } from "../../src/heatmap/tileMath";

describe("the cells a view can hold", () => {
  it("counts the whole cells of the viewport, rows by columns", () => {
    const bbox = [3.7, 51.0, 3.72, 51.01] as const;
    const view = viewCells(bbox, 18);
    const columns = lonToTileX(3.72, 18) - lonToTileX(3.7, 18) + 1;
    const rows = latToTileY(51.0, 18) - latToTileY(51.01, 18) + 1;
    expect(view).toMatchObject({ wraps: false, count: columns * rows });
    expect(view.rows).toEqual([latToTileY(51.01, 18), latToTileY(51.0, 18)]);
  });

  it("runs across the antimeridian when the west is east of the east", () => {
    const view = viewCells([179.99, 0, -179.99, 0.01], 12);
    expect(view.wraps).toBe(true);
    // The last columns of the world and the first ones: the two edges, not the world between.
    expect(view.count).toBeLessThan(10);
    expect(view.count).toBeGreaterThanOrEqual(2);
  });

  it("is the cell count up to the ceiling, and never less than one", () => {
    expect(heatCellCap([3.7, 51.0, 3.7001, 51.0001], 20)).toBe(
      viewCells([3.7, 51.0, 3.7001, 51.0001], 20).count,
    );
    expect(heatCellCap([-180, -85, 180, 85], 20)).toBe(heatCellCeiling);
    expect(heatCellCeiling).toBe(65_536);
    expect(heatCellCap([3.7, 51, 3.7, 51], 6)).toBe(1);
  });

  it("holds a 4K screen at the worst fractional zoom", () => {
    // Cells are 16 px at a whole zoom and 16 / √2 = 11.3 px just before the next: 3840 × 2160 CSS
    // pixels hold some 64 800 of them.
    const cell = 16 / Math.SQRT2;
    expect(Math.ceil(3840 / cell) * Math.ceil(2160 / cell)).toBeLessThanOrEqual(heatCellCeiling);
  });
});

describe("the heatmap contract", () => {
  const base = { bbox: "3.4,50.9,3.8,51.1", zoom: "12" };

  it("defaults to points and takes a period only for time and visits", () => {
    expect(heatmapQuerySchema.parse(base).heat).toBe("points");
    expect(
      heatmapQuerySchema.safeParse({ ...base, from: "2026-10-01", to: "2026-10-31" }).success,
    ).toBe(false);
    expect(
      heatmapQuerySchema.safeParse({ ...base, heat: "time", from: "2026-10-01", to: "2026-10-31" })
        .success,
    ).toBe(true);
    expect(heatmapQuerySchema.safeParse({ ...base, heat: "visits" }).success).toBe(true);
    expect(heatmapQuerySchema.safeParse({ ...base, heat: "speed" }).success).toBe(false);
  });

  it("keeps a period ordered and within three years", () => {
    const query = { ...base, heat: "time" };
    expect(
      heatmapQuerySchema.safeParse({ ...query, from: "2026-10-31", to: "2026-10-01" }).success,
    ).toBe(false);
    expect(
      heatmapQuerySchema.safeParse({ ...query, from: "2022-01-01", to: "2026-10-01" }).success,
    ).toBe(false);
  });

  it("answers whole-number tuples of tiles and values", () => {
    const answer = {
      heat: "time",
      cellZoom: 18,
      cells: [[133773, 87718, 3600]],
      truncated: false,
      period: { from: "2026-10-01", to: "2026-10-31" },
      pending: false,
    };
    expect(heatmapResponseSchema.safeParse(answer).success).toBe(true);
    for (const cells of [[[1.5, 2, 3]], [[1, 2, 0]], [[-1, 2, 3]], [[1, 2]]]) {
      expect(heatmapResponseSchema.safeParse({ ...answer, cells }).success).toBe(false);
    }
    expect(heatmapResponseSchema.safeParse({ ...answer, cellZoom: 21 }).success).toBe(false);
    expect(heatmapResponseSchema.safeParse({ ...answer, period: null }).success).toBe(true);
  });
});
