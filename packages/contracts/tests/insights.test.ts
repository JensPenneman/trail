import { describe, expect, it } from "vitest";
import {
  insightsModeFilterQuerySchema,
  insightsQuerySchema,
  lastInsightsDay,
} from "../src/insights";

describe("Insights queries", () => {
  it("take a period of local days, both ends optional", () => {
    expect(insightsQuerySchema.parse({})).toEqual({});
    expect(insightsQuerySchema.parse({ from: "2026-10-01", to: "2026-10-31" })).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(insightsQuerySchema.parse({ devices: "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3" })).toEqual({
      devices: ["0199a0f3-5fec-72ad-a30c-5ab9d8908cd3"],
    });
    expect(insightsQuerySchema.safeParse({ from: "2026-10-31", to: "2026-10-01" }).success).toBe(
      false,
    );
    expect(insightsQuerySchema.safeParse({ from: "2026-02-30" }).success).toBe(false);
  });

  it("span three years at most", () => {
    expect(insightsQuerySchema.safeParse({ from: "2023-10-28", to: "2026-10-27" }).success).toBe(
      true,
    );
    expect(insightsQuerySchema.safeParse({ from: "2023-10-27", to: "2026-10-27" }).success).toBe(
      false,
    );
    expect(lastInsightsDay("2023-10-28")).toBe("2026-10-27");
    expect(lastInsightsDay("2024-02-29")).toBe("2027-02-28");
    expect(lastInsightsDay("2025-03-01")).toBe("2028-02-29");
  });

  it("filter by a transport mode", () => {
    expect(insightsModeFilterQuerySchema.parse({ mode: "cycling" })).toEqual({ mode: "cycling" });
    expect(insightsModeFilterQuerySchema.safeParse({ mode: "hovercraft" }).success).toBe(false);
  });
});
