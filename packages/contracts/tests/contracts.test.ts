import { describe, expect, it } from "vitest";
import { deviceStatus } from "../src/deviceStatus";
import { emailSchema } from "../src/email";
import { heatmapQuerySchema } from "../src/heatmap";
import { overlandSetupUrl } from "../src/overlandSetupUrl";
import { type TrackPoint, tracksQuerySchema } from "../src/track";
import { trackSegments } from "../src/trackSegments";

describe("deviceStatus", () => {
  const thresholds = { liveMinutes: 15, staleHours: 12 };
  const now = new Date("2026-09-30T12:00:00.000Z");

  it("classifies by the age of the last upload", () => {
    expect(deviceStatus(null, now, thresholds)).toBe("never");
    expect(deviceStatus("2026-09-30T11:50:00.000Z", now, thresholds)).toBe("live");
    expect(deviceStatus("2026-09-30T06:00:00.000Z", now, thresholds)).toBe("idle");
    expect(deviceStatus("2026-09-29T20:00:00.000Z", now, thresholds)).toBe("stale");
  });
});

describe("overlandSetupUrl", () => {
  it("encodes the endpoint, token and device id as Overland expects", () => {
    const url = overlandSetupUrl({
      endpoint: "https://trail.example.com/api/overland",
      accessToken: "trl_abc-DEF_123",
      deviceKey: "iphone-7k2p",
    });
    expect(url).toBe(
      "overland://setup?url=https%3A%2F%2Ftrail.example.com%2Fapi%2Foverland&token=trl_abc-DEF_123&device_id=iphone-7k2p",
    );
  });
});

describe("query schemas", () => {
  it("normalises emails", () => {
    expect(emailSchema.parse("  Jens@Example.COM ")).toBe("jens@example.com");
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  });

  it("parses track queries with defaults and rejects inverted ranges", () => {
    const parsed = tracksQuerySchema.parse({
      from: "2026-09-30T00:00:00.000Z",
      to: "2026-10-01T00:00:00.000Z",
    });
    expect(parsed.maxPoints).toBe(8000);
    expect(parsed.maxAccuracy).toBe(200);
    expect(
      tracksQuerySchema.safeParse({
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-09-30T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("parses a heatmap bbox", () => {
    const parsed = heatmapQuerySchema.parse({ bbox: "3.2,50.9,3.9,51.2", zoom: "11" });
    expect(parsed.bbox).toEqual([3.2, 50.9, 3.9, 51.2]);
    expect(parsed.zoom).toBe(11);
  });
});

describe("trackSegments", () => {
  it("splits at gaps longer than the threshold", () => {
    const p = (t: number): TrackPoint => [3.7, 51.05, t, null, null, null];
    const segments = trackSegments([p(0), p(60), p(120), p(2000), p(2060)]);
    expect(segments.map((segment) => segment.map((point) => point[2]))).toEqual([
      [0, 60, 120],
      [2000, 2060],
    ]);
    expect(trackSegments([])).toEqual([]);
  });
});
