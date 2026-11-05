import { describe, expect, it } from "vitest";
import {
  edgeClasses,
  edgeSpeeds,
  type PathPoint,
  paceBands,
  smoothed,
  speedBands,
  speedClassOf,
  timeClassOf,
} from "../src/map/pathColour/pathClasses";

/** A point `metres` east of the origin on the equator, `t` seconds in. */
const at = (metres: number, t: number, ...rest: (number | null)[]): PathPoint => [
  metres / 111_195,
  0,
  t,
  ...rest,
];

describe("speed bands", () => {
  it("cut at 6, 15, 30 and 70 km/h, and at paces of 12:00, 9:00, 7:00 and 5:30 on foot", () => {
    expect(speedBands.map((value) => Math.round(value * 3.6 * 10) / 10)).toEqual([6, 15, 30, 70]);
    expect(paceBands.map((value) => Math.round(1000 / value))).toEqual([720, 540, 420, 330]);
  });

  it("put a speed at its band, edges in the faster", () => {
    expect(speedClassOf(1, speedBands)).toBe(0);
    expect(speedClassOf(6 / 3.6, speedBands)).toBe(1);
    expect(speedClassOf(14.9 / 3.6, speedBands)).toBe(1);
    expect(speedClassOf(15 / 3.6, speedBands)).toBe(2);
    expect(speedClassOf(100, speedBands)).toBe(4);
    expect(speedClassOf(1000 / 800, paceBands)).toBe(0);
    expect(speedClassOf(1000 / 300, paceBands)).toBe(4);
  });
});

describe("the speed of each interval", () => {
  it("is the phone's own at raw, the mean of both ends, else distance over time", () => {
    const points = [at(0, 0, 5), at(100, 10, 7), at(200, 20, null)];
    // Mean of 5 and 7; then 7 alone (the other end has none).
    expect(edgeSpeeds(points, 3)).toEqual([6, 7]);
    // Without a speed at either end: 100 m in 10 s.
    expect(edgeSpeeds([at(0, 0, null), at(100, 10, null)], 3)[0]).toBeCloseTo(10, 1);
  });

  it("is distance over time at the other levels, whatever the points carry", () => {
    expect(edgeSpeeds([at(0, 0, 99), at(50, 10, 99)], null)[0]).toBeCloseTo(5, 2);
  });

  it("takes a neighbour's speed for an interval without time, and none where there is none", () => {
    const speeds = edgeSpeeds([at(0, 0), at(50, 10), at(50, 10), at(100, 20)], null);
    expect(speeds[1]).toBeCloseTo(speeds[0] ?? 0, 6);
    expect(edgeSpeeds([at(0, 5), at(10, 5)], null)).toEqual([null]);
  });

  it("is smoothed by the median of three intervals, leaving unknown ones unknown", () => {
    expect(smoothed([1, 1, 20, 1, 1])).toEqual([1, 1, 1, 1, 1]);
    expect(smoothed([2, null, 4])).toEqual([2, null, 4]);
    expect(smoothed([null])).toEqual([null]);
  });
});

describe("the time of day", () => {
  const brussels = "Europe/Brussels";
  const utc = (iso: string) => Date.parse(iso) / 1000;

  it("is night 22–06, morning 06–12, afternoon 12–18, evening 18–22, in the account's zone", () => {
    // 26 October 2026 is summer time in Brussels until 03:00 on the 25th: here winter, UTC+1.
    expect(timeClassOf(utc("2026-10-27T05:59:00Z"), brussels)).toBe(1);
    expect(timeClassOf(utc("2026-10-27T04:59:00Z"), brussels)).toBe(0);
    expect(timeClassOf(utc("2026-10-27T10:59:00Z"), brussels)).toBe(1);
    expect(timeClassOf(utc("2026-10-27T11:00:00Z"), brussels)).toBe(2);
    expect(timeClassOf(utc("2026-10-27T17:00:00Z"), brussels)).toBe(3);
    expect(timeClassOf(utc("2026-10-27T21:00:00Z"), brussels)).toBe(0);
    expect(timeClassOf(utc("2026-10-27T21:00:00Z"), "UTC")).toBe(3);
    expect(timeClassOf(utc("2026-10-27T11:00:00Z"), "UTC")).toBe(1);
  });

  it("follows summer time and winter time on the days of the change", () => {
    // 29 March 2026: 02:00 becomes 03:00; 25 October: 03:00 becomes 02:00.
    expect(timeClassOf(utc("2026-03-28T23:59:00Z"), brussels)).toBe(0);
    expect(timeClassOf(utc("2026-03-29T03:59:00Z"), brussels)).toBe(0);
    expect(timeClassOf(utc("2026-03-29T04:00:00Z"), brussels)).toBe(1);
    expect(timeClassOf(utc("2026-10-25T04:59:00Z"), brussels)).toBe(0);
    expect(timeClassOf(utc("2026-10-25T05:00:00Z"), brussels)).toBe(1);
  });

  it("tells the hour in a zone off by half an hour from every half hour of an hour", () => {
    // India is UTC+5:30: 12:40 UTC is 18:10 (evening), 12:15 UTC is 17:45 (afternoon).
    expect(timeClassOf(utc("2026-10-27T12:40:00Z"), "Asia/Kolkata")).toBe(3);
    expect(timeClassOf(utc("2026-10-27T12:15:00Z"), "Asia/Kolkata")).toBe(2);
    expect(timeClassOf(utc("2026-10-27T12:29:00Z"), "Asia/Kolkata")).toBe(2);
    expect(timeClassOf(utc("2026-10-27T12:30:00Z"), "Asia/Kolkata")).toBe(3);
  });

  it("classes each interval by the time it began", () => {
    const points: PathPoint[] = [
      at(0, utc("2026-10-27T11:59:50Z")),
      at(10, utc("2026-10-27T12:00:10Z")),
      at(20, utc("2026-10-27T12:00:30Z")),
    ];
    expect(
      edgeClasses(points, { by: "time", speedColumn: null, onFoot: false, timeZone: "UTC" }),
    ).toEqual([1, 2]);
    expect(
      edgeClasses(points.slice(0, 2), {
        by: "time",
        speedColumn: null,
        onFoot: false,
        timeZone: "UTC",
      }),
    ).toEqual([1]);
  });

  it("classes speed by pace when everything drawn is on foot", () => {
    const walk = [at(0, 0), at(14, 10), at(28, 20)];
    // 1.4 m/s = 11:54 /km: slower than 12:00? no: faster, so band 1 in paces, band 0 in km/h.
    expect(
      edgeClasses(walk, { by: "speed", speedColumn: null, onFoot: true, timeZone: "UTC" }),
    ).toEqual([1, 1]);
    expect(
      edgeClasses(walk, { by: "speed", speedColumn: null, onFoot: false, timeZone: "UTC" }),
    ).toEqual([0, 0]);
  });
});
