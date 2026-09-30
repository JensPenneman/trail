import type { TrackPoint } from "@trail/contracts/track";
import { trackSegments } from "@trail/contracts/trackSegments";
import { describe, expect, it } from "vitest";
import { rdpImportance } from "../../src/tracks/rdpImportance";
import { simplifyTrack } from "../../src/tracks/simplifyTrack";
import { TrackThinner } from "../../src/tracks/trackThinner";

/** A point `metresEast`/`metresNorth` from a Ghent reference, one per `t` second. */
const at = (metresEast: number, metresNorth: number, t: number): TrackPoint => [
  3.7174 + metresEast / (111_320 * Math.cos((51.0543 * Math.PI) / 180)),
  51.0543 + metresNorth / 110_574,
  t,
  null,
  null,
  null,
];

describe("rdpImportance", () => {
  it("gives end points infinite importance and collinear points none", () => {
    const line = [at(0, 0, 0), at(10, 0, 1), at(20, 0, 2), at(30, 0, 3)];
    const importance = rdpImportance(line);
    expect(importance[0]).toBe(Number.POSITIVE_INFINITY);
    expect(importance[3]).toBe(Number.POSITIVE_INFINITY);
    expect(importance[1]).toBeCloseTo(0, 3);
    expect(importance[2]).toBeCloseTo(0, 3);
  });

  it("scores a corner by its distance from the chord, in metres", () => {
    const corner = [at(0, 0, 0), at(50, 40, 1), at(100, 0, 2)];
    expect(rdpImportance(corner)[1]).toBeCloseTo(40, 0);
  });

  it("never scores a point above the split that created its range", () => {
    // The bump at x=60 (8 m) sits inside the range split at the big corner (100 m).
    const track = [at(0, 0, 0), at(60, 8, 1), at(100, 100, 2), at(200, 0, 3)];
    const importance = rdpImportance(track);
    expect(importance[2]).toBeGreaterThan(importance[1] ?? 0);
  });
});

describe("simplifyTrack", () => {
  const zigzag = Array.from({ length: 1000 }, (_, index) =>
    at(index * 10, (index % 2 === 0 ? 1 : -1) * (index % 50), index),
  );

  it("returns short tracks unchanged", () => {
    const track = zigzag.slice(0, 50);
    expect(simplifyTrack([track], 100)).toEqual(track);
  });

  it("fits the budget with one tolerance and keeps the end points", () => {
    const simplified = simplifyTrack([zigzag], 100);
    expect(simplified.length).toBeLessThanOrEqual(100);
    expect(simplified.length).toBeGreaterThan(80);
    expect(simplified[0]).toBe(zigzag[0]);
    expect(simplified.at(-1)).toBe(zigzag.at(-1));
    const times = simplified.map((point) => point[2]);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("keeps the end points of every segment", () => {
    const first = zigzag.slice(0, 500);
    const second = zigzag
      .slice(500)
      .map((point): TrackPoint => [point[0], point[1], point[2] + 5000, null, null, null]);
    const simplified = simplifyTrack([first, second], 100);
    for (const point of [first[0], first.at(-1), second[0], second.at(-1)]) {
      expect(simplified).toContain(point);
    }
    expect(simplified.length).toBeLessThanOrEqual(100);
  });

  it("samples evenly when segment end points alone exceed the budget", () => {
    const isolated = Array.from({ length: 300 }, (_, index) => at(index * 100, 0, index * 1000));
    const segments = trackSegments(isolated);
    expect(segments).toHaveLength(300);
    expect(simplifyTrack(segments, 100)).toHaveLength(100);
  });
});

describe("TrackThinner", () => {
  it("keeps every point below its limit", () => {
    const thinner = new TrackThinner(1000);
    for (const point of zigzagPoints(500)) thinner.add(point);
    expect(thinner.finish()).toHaveLength(500);
  });

  it("thins dense tracks but keeps first, last and segment boundaries", () => {
    const thinner = new TrackThinner(1000);
    const points = [
      ...zigzagPoints(5000),
      ...zigzagPoints(5000).map(
        (point): TrackPoint => [point[0], point[1], point[2] + 20_000, null, null, null],
      ),
    ];
    for (const point of points) thinner.add(point);
    const kept = thinner.finish();
    expect(kept.length).toBeLessThan(2500);
    expect(kept[0]).toBe(points[0]);
    expect(kept.at(-1)).toBe(points.at(-1));
    expect(kept).toContain(points[4999]);
    expect(kept).toContain(points[5000]);
    expect(trackSegments(kept)).toHaveLength(2);
  });
});

function zigzagPoints(count: number): TrackPoint[] {
  return Array.from({ length: count }, (_, index) => at(index * 3, index % 7, index));
}
