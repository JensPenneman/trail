import type { TrackPoint } from "@trail/contracts/track";
import type { Segment } from "@trail/contracts/transport";
import { describe, expect, it } from "vitest";
import {
  dayBounds,
  dayOf,
  endOf,
  mergeIntervals,
  movementOf,
  movesOf,
  movingStretches,
  nextDayWithData,
  previousDayWithData,
  quietIntervals,
  splitTime,
} from "../src/pages/map/history/playback/playbackModel";

const zone = "Europe/Brussels";

/** Points a second apart along a line at `speed` m/s (north, 111 km per degree), from `t0`. */
function drive(t0: number, seconds: number, speed: number, lat0 = 51): TrackPoint[] {
  return Array.from({ length: seconds + 1 }, (_, index) => [
    3.7,
    lat0 + (speed * index) / 111_000,
    t0 + index,
    speed,
    5,
    null,
  ]);
}

describe("days", () => {
  it("bound a local day by its midnights, 23 or 25 hours long around the clock change", () => {
    const normal = dayBounds("2026-11-03", zone);
    expect(normal.end - normal.start).toBe(86_400);
    expect(dayBounds("2026-03-29", zone).end - dayBounds("2026-03-29", zone).start).toBe(82_800);
    expect(dayBounds("2026-10-25", zone).end - dayBounds("2026-10-25", zone).start).toBe(90_000);
  });

  it("name the local day an instant is in", () => {
    const { start, end } = dayBounds("2026-11-03", zone);
    expect(dayOf(start, zone)).toBe("2026-11-03");
    expect(dayOf(end - 1, zone)).toBe("2026-11-03");
    expect(dayOf(end, zone)).toBe("2026-11-04");
  });

  it("find the next and previous day with data, or none", () => {
    const days = ["2026-11-01", "2026-11-04", "2026-11-09"];
    expect(nextDayWithData(days, "2026-11-01")).toBe("2026-11-04");
    expect(nextDayWithData(days, "2026-11-02")).toBe("2026-11-04");
    expect(nextDayWithData(days, "2026-11-09")).toBeNull();
    expect(previousDayWithData(days, "2026-11-04")).toBe("2026-11-01");
    expect(previousDayWithData(days, "2026-11-01")).toBeNull();
  });

  it("end at the last point of the final day once it is in, else at the endpoint's guess", () => {
    expect(endOf(100, 120, true)).toBe(120);
    expect(endOf(100, null, true)).toBe(100);
    expect(endOf(null, null, true)).toBeNull();
  });

  it("do not end anywhere while the list of days may still grow", () => {
    expect(endOf(100, 120, false)).toBeNull();
    expect(endOf(100, null, false)).toBeNull();
  });

  it("cut the map's tracks four times per playback second at most", () => {
    // A quarter of the minutes that pass in a second: 15 s at 1 min/s, 15 min at 1 h/s.
    expect(splitTime(1000, 1)).toBe(990);
    expect(splitTime(1004, 1)).toBe(1004 - (1004 % 15));
    expect(splitTime(3601, 60)).toBe(3600);
    expect(splitTime(3600 * 1.9, 60)).toBe(3600 * 1.75);
    for (const rate of [1, 5, 15, 60] as const) {
      const step = (rate * 60) / 4;
      expect(splitTime(step * 7 + 1, rate)).toBe(step * 7);
      expect(splitTime(step * 7, rate)).toBe(step * 7);
    }
  });
});

describe("intervals", () => {
  it("merge what overlaps or touches, in order", () => {
    expect(
      mergeIntervals([
        { from: 50, to: 60 },
        { from: 0, to: 10 },
        { from: 10, to: 20 },
        { from: 15, to: 30 },
      ]),
    ).toEqual([
      { from: 0, to: 30 },
      { from: 50, to: 60 },
    ]);
  });

  it("make the quiet stretches what lies outside the moves", () => {
    const moves = [
      { from: 100, to: 200 },
      { from: 150, to: 300 },
      { from: 500, to: 600 },
    ];
    expect(quietIntervals({ from: 0, to: 1000 }, moves)).toEqual([
      { from: 0, to: 100 },
      { from: 300, to: 500 },
      { from: 600, to: 1000 },
    ]);
    expect(quietIntervals({ from: 120, to: 550 }, moves)).toEqual([{ from: 300, to: 500 }]);
    expect(quietIntervals({ from: 0, to: 50 }, [])).toEqual([{ from: 0, to: 50 }]);
  });

  it("take the timeline's moves, merged across devices", () => {
    const segment = (kind: "stop" | "move", from: number, to: number) =>
      ({
        kind,
        startedAt: new Date(from * 1000).toISOString(),
        endedAt: new Date(to * 1000).toISOString(),
      }) as Segment;
    expect(
      movesOf([segment("stop", 0, 100), segment("move", 100, 200), segment("move", 150, 400)]),
    ).toEqual([{ from: 100, to: 400 }]);
  });
});

describe("movement stretches, from the points alone", () => {
  const t0 = 1_800_000_000;

  it("keep a drive of a minute and 100 m, from its first to its last point", () => {
    expect(movingStretches([drive(t0, 120, 10)])).toEqual([{ from: t0, to: t0 + 120 }]);
  });

  it("drop what lasts less than a minute or covers less than 100 m", () => {
    expect(movingStretches([drive(t0, 30, 10)])).toEqual([]);
    expect(movingStretches([drive(t0, 120, 0.7)])).toEqual([]);
  });

  it("cut at a stand-still of three minutes, and not at a shorter one", () => {
    const first = drive(t0, 120, 10);
    const still = (from: number, seconds: number): TrackPoint[] =>
      Array.from({ length: seconds / 10 + 1 }, (_, index) => [
        3.7,
        51.01,
        from + index * 10,
        0,
        5,
        null,
      ]);
    const long = [...first, ...still(t0 + 130, 200), ...drive(t0 + 340, 120, 10)];
    expect(movingStretches([long])).toHaveLength(2);
    const short = [...first, ...still(t0 + 130, 100), ...drive(t0 + 240, 120, 10)];
    expect(movingStretches([short])).toEqual([{ from: t0, to: t0 + 360 }]);
  });

  it("split at a recording gap and never join across it", () => {
    const stretches = movingStretches([[...drive(t0, 120, 10), ...drive(t0 + 2000, 120, 10)]]);
    expect(stretches).toEqual([
      { from: t0, to: t0 + 120 },
      { from: t0 + 2000, to: t0 + 2120 },
    ]);
  });

  it("work out a speed the points lack from where they are", () => {
    const withoutSpeed = drive(t0, 120, 10).map((point) => [...point.slice(0, 3), null, 5, null]);
    expect(movingStretches([withoutSpeed as unknown as TrackPoint[]])).toEqual([
      { from: t0, to: t0 + 120 },
    ]);
  });
});

describe("moving or still", () => {
  it("is told by the speed", () => {
    expect(movementOf(null)).toBeNull();
    expect(movementOf(0.2)).toBe("Still");
    expect(movementOf(0.6)).toBe("Moving");
    expect(movementOf(12)).toBe("Moving");
  });
});
