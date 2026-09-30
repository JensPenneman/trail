import type { TrackPoint, TracksResponse } from "@trail/contracts/track";
import { describe, expect, it } from "vitest";
import { appendTrackPoints } from "../src/live/appendTrackPoints";
import { ids, tracks } from "./support/fixtures";

const range = { from: "2026-09-29T22:00:00.000Z", to: "2026-09-30T22:00:00.000Z" };
const t = (hour: number) =>
  Date.parse(`2026-09-30T${String(hour).padStart(2, "0")}:00:00.000Z`) / 1000;
const point = (time: number, accuracy: number | null = 10): TrackPoint => [
  3.5,
  51,
  time,
  1,
  accuracy,
  10,
];

describe("appendTrackPoints", () => {
  it("keeps points sorted and never duplicates a second", () => {
    const base = tracks(range.from, range.to);
    const first = base.tracks[0];
    if (first === undefined) throw new Error("fixture without a track");
    const existing = first.points[1];
    if (existing === undefined) throw new Error("fixture without points");
    const next = appendTrackPoints(base, ids.phone, [point(existing[2]), point(t(3))], 200);
    const points = next.tracks[0]?.points ?? [];
    expect(points.map((entry) => entry[2])).toEqual(
      [...points.map((entry) => entry[2])].sort((a, b) => a - b),
    );
    expect(points).toHaveLength(4);
    expect(next.tracks[0]?.lastAt).toBe(
      new Date(Math.max(...points.map((entry) => entry[2])) * 1000).toISOString(),
    );
  });

  it("ignores points outside the range or with poor accuracy", () => {
    const base: TracksResponse = { ...range, tracks: [] };
    const outside = t(23);
    expect(appendTrackPoints(base, ids.phone, [point(outside), point(t(10), 900)], 200)).toBe(base);
  });

  it("starts a track for a device that had none in the range", () => {
    const base: TracksResponse = { ...range, tracks: [] };
    const next = appendTrackPoints(base, ids.car, [point(t(8)), point(t(9), null)], 200);
    expect(next.tracks).toHaveLength(1);
    expect(next.tracks[0]).toMatchObject({ deviceId: ids.car, total: 2, returned: 2 });
  });
});
