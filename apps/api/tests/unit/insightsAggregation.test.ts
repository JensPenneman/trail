import { describe, expect, it } from "vitest";
import { buildModeInsights } from "../../src/insights/buildModeInsights";
import { buildOverview } from "../../src/insights/buildOverview";
import { buildRoads } from "../../src/insights/buildRoads";
import { buildTimeGrid } from "../../src/insights/buildTimeGrid";
import type { InsightMove } from "../../src/insights/insightMoves";
import { previousPeriod } from "../../src/insights/insightsPeriod";
import { localHours } from "../../src/insights/localHours";
import { emptyRoadTally, familyRows, kindRows, tallyRoads } from "../../src/insights/roadTally";
import { speedHistogram } from "../../src/insights/speedHistogram";
import { topMoves, typicalSpeedKmh } from "../../src/insights/topMoves";

const zone = "Europe/Brussels";
let sequence = 0;

/** A move between two instants; the id orders like the start. */
function move(
  start: string,
  end: string,
  input: Partial<Omit<InsightMove, "startMs" | "endMs">> = {},
): InsightMove {
  sequence += 1;
  return {
    id: `0199a0f3-0000-7000-8000-${String(sequence).padStart(12, "0")}`,
    deviceId: "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3",
    mode: "car",
    distanceM: 10_000,
    maxSpeedMs: 20,
    medianKmh: 40,
    wayKinds: null,
    dwells: null,
    ...input,
    startMs: Date.parse(start),
    endMs: Date.parse(end),
  };
}

describe("the overview", () => {
  // The week of 20 to 26 October 2026, summer time ending on the night to Sunday the 25th.
  const period = { from: "2026-10-20", to: "2026-10-26", days: 7 };
  const previous = previousPeriod(period);
  const overview = (moves: InsightMove[], stops = { current: 0, previous: 0 }) =>
    buildOverview({
      timezone: zone,
      period,
      bucket: "day",
      previous,
      hours: localHours(period.from, period.to, zone),
      previousHours: localHours(previous.from, previous.to, zone),
      moves,
      stops,
      pending: false,
    });

  it("adds up distance and time, counts what started inside and the days on the move", () => {
    const result = overview(
      [
        move("2026-10-21T07:00:00Z", "2026-10-21T07:30:00Z", { mode: "cycling", distanceM: 9000 }),
        move("2026-10-21T16:00:00Z", "2026-10-21T17:00:00Z", { mode: "train", distanceM: 60_000 }),
        move("2026-10-23T08:00:00Z", "2026-10-23T08:20:00Z", { mode: "walking", distanceM: 1500 }),
      ],
      { current: 5, previous: 2 },
    );
    expect(result.totals).toEqual({
      distanceM: 70_500,
      durationS: 6600,
      moves: 3,
      stops: 5,
      activeDays: 2,
    });
    expect(result.previous).toEqual({
      ...previous,
      totals: { distanceM: 0, durationS: 0, moves: 0, stops: 2, activeDays: 0 },
    });
    expect(result.period).toMatchObject({ ...period, bucket: "day" });
    expect(result.period.buckets).toHaveLength(7);
    expect(result.modes.map((row) => [row.mode, row.distanceM, row.share])).toEqual([
      ["train", 60_000, 0.851],
      ["cycling", 9000, 0.128],
      ["walking", 1500, 0.021],
    ]);
    expect(result.modes[0]).toMatchObject({ durationS: 3600, moves: 1, avgSpeedKmh: 60 });
  });

  it("prorates a move across local midnight and across the period's edge", () => {
    const result = overview([
      // 23:30 on the 21st to 00:30 on the 22nd, local summer time.
      move("2026-10-21T21:30:00Z", "2026-10-21T22:30:00Z", { distanceM: 8000 }),
      // Started on the 19th, before the period: half of it is inside.
      move("2026-10-19T21:00:00Z", "2026-10-19T23:00:00Z", { distanceM: 4000 }),
    ]);
    expect(result.series).toEqual([
      { bucket: "2026-10-20", mode: "car", distanceM: 2000, durationS: 3600 },
      { bucket: "2026-10-21", mode: "car", distanceM: 4000, durationS: 1800 },
      { bucket: "2026-10-22", mode: "car", distanceM: 4000, durationS: 1800 },
    ]);
    // The move from before counts its distance inside, but as a move of the previous period.
    expect(result.totals).toMatchObject({ distanceM: 10_000, moves: 1, activeDays: 3 });
    expect(result.previous.totals).toMatchObject({ distanceM: 2000, moves: 1, activeDays: 1 });
  });

  it("gives the night summer time ends its 25 hours", () => {
    // 21:00 local on the 24th to 02:30 winter time on the 25th: six and a half hours.
    const result = overview([
      move("2026-10-24T19:00:00Z", "2026-10-25T01:30:00Z", { distanceM: 13_000 }),
    ]);
    expect(result.series).toEqual([
      { bucket: "2026-10-24", mode: "car", distanceM: 6000, durationS: 10_800 },
      { bucket: "2026-10-25", mode: "car", distanceM: 7000, durationS: 12_600 },
    ]);
  });

  it("compares every mode with the period before, the modes gone included in the totals", () => {
    const result = overview([
      move("2026-10-14T07:00:00Z", "2026-10-14T08:00:00Z", { mode: "train", distanceM: 50_000 }),
      move("2026-10-15T07:00:00Z", "2026-10-15T07:30:00Z", { mode: "bus", distanceM: 7000 }),
      move("2026-10-21T07:00:00Z", "2026-10-21T08:00:00Z", { mode: "train", distanceM: 65_000 }),
    ]);
    expect(result.modes).toEqual([
      {
        mode: "train",
        distanceM: 65_000,
        durationS: 3600,
        moves: 1,
        avgSpeedKmh: 65,
        share: 1,
        deltaDistanceM: 15_000,
      },
    ]);
    expect(result.previous.totals).toMatchObject({ distanceM: 57_000, moves: 2 });
  });

  it("is empty but whole without any move", () => {
    const result = overview([]);
    expect(result.totals).toEqual({
      distanceM: 0,
      durationS: 0,
      moves: 0,
      stops: 0,
      activeDays: 0,
    });
    expect(result.modes).toEqual([]);
    expect(result.series).toEqual([]);
    expect(result.period.buckets).toHaveLength(7);
  });
});

describe("one mode", () => {
  const period = { from: "2026-10-19", to: "2026-10-25", days: 7 };
  const build = (moves: InsightMove[], mode: InsightMove["mode"] = "train") =>
    buildModeInsights({
      timezone: zone,
      mode,
      period,
      bucket: "day",
      hours: localHours(period.from, period.to, zone),
      moves,
      pending: true,
    });

  const trains = () => [
    move("2026-10-20T06:00:00Z", "2026-10-20T07:00:00Z", {
      mode: "train",
      distanceM: 90_000,
      maxSpeedMs: 40,
      medianKmh: 100,
      wayKinds: { rail: 0.9, residential: 0.1 },
      dwells: { station: 3, tramStop: 0, subway: 0 },
    }),
    move("2026-10-22T16:00:00Z", "2026-10-22T16:30:00Z", {
      mode: "train",
      distanceM: 30_000,
      maxSpeedMs: 45,
      medianKmh: 70,
      wayKinds: null,
      dwells: null,
    }),
    move("2026-10-24T09:00:00Z", "2026-10-24T09:10:00Z", { mode: "bus", distanceM: 3000 }),
  ];

  it("has the tiles, the longest and the fastest", () => {
    const result = build(trains());
    expect(result.totals).toMatchObject({
      distanceM: 120_000,
      durationS: 5400,
      moves: 2,
      avgSpeedKmh: 80,
      // Weighted by time, the hour at 100 km/h outweighs the half hour at 70.
      typicalSpeedKmh: 100,
    });
    expect(result.totals.longest?.distanceM).toBe(90_000);
    expect(result.totals.fastest).toMatchObject({ distanceM: 30_000, maxSpeedKmh: 162 });
    expect(result.pending).toBe(true);
  });

  it("splits distance and time over the hours of the day and the weekdays", () => {
    const result = build(trains());
    expect(result.byHour).toHaveLength(24);
    expect(result.byHour[8]).toEqual({ hour: 8, distanceM: 90_000, durationS: 3600 });
    expect(result.byHour[18]).toEqual({ hour: 18, distanceM: 30_000, durationS: 1800 });
    expect(result.byWeekday.map((day) => day.distanceM)).toEqual([0, 90_000, 0, 30_000, 0, 0, 0]);
    const sum = result.byHour.reduce((total, hour) => total + hour.distanceM, 0);
    expect(sum).toBe(result.totals.distanceM);
    expect(result.series.map((step) => step.distanceM)).toEqual([0, 90_000, 0, 30_000, 0, 0, 0]);
  });

  it("tells the rail share and the halts at stations, from the moves with map data", () => {
    const result = build(trains());
    expect(result.roads).toEqual({
      distanceM: 120_000,
      mappedM: 90_000,
      kinds: [
        { kind: "residential", distanceM: 9000, share: 0.1 },
        { kind: "rail", distanceM: 81_000, share: 0.9 },
      ],
    });
    expect(result.rail).toEqual({ distanceM: 81_000, share: 0.9 });
    expect(result.ferry).toBeNull();
    expect(result.stationStops).toBe(3);
  });

  it("leaves rail and halts out for road modes, and lists the top moves", () => {
    const result = build(trains(), "bus");
    expect(result.rail).toBeNull();
    expect(result.stationStops).toBeNull();
    expect(result.totals.moves).toBe(1);
    expect(result.topMoves.recent).toHaveLength(1);
    expect(result.topMoves.recent[0]).toMatchObject({
      distanceM: 3000,
      durationS: 600,
      avgSpeedKmh: 18,
      startedAt: "2026-10-24T09:00:00.000Z",
      endedAt: "2026-10-24T09:10:00.000Z",
    });
  });

  it("puts the moves in speed bins from 0", () => {
    const result = build(trains());
    expect(result.speedHistogram.binKmh).toBe(10);
    expect(result.speedHistogram.bins).toHaveLength(11);
    expect(result.speedHistogram.bins[7]).toEqual({ fromKmh: 70, toKmh: 80, moves: 1 });
    expect(result.speedHistogram.bins[10]).toEqual({ fromKmh: 100, toKmh: 110, moves: 1 });
  });

  it("is whole without moves", () => {
    const result = build([], "plane");
    expect(result.totals).toEqual({
      distanceM: 0,
      durationS: 0,
      moves: 0,
      avgSpeedKmh: 0,
      typicalSpeedKmh: null,
      longest: null,
      fastest: null,
    });
    expect(result.series).toHaveLength(7);
    expect(result.speedHistogram.bins).toEqual([]);
    expect(result.topMoves).toEqual({ longest: [], fastest: [], recent: [] });
  });
});

describe("roads", () => {
  it("scales rounded shares to the whole and counts moves without them as unmapped", () => {
    const tally = emptyRoadTally();
    tallyRoads(tally, 1000, { motorway: 0.333, primary: 0.333, residential: 0.333 });
    tallyRoads(tally, 500, null);
    tallyRoads(tally, 0, { cycleway: 1 });
    expect(tally.distanceM).toBe(1500);
    expect(tally.mappedM).toBe(1000);
    const kinds = kindRows(tally);
    expect(kinds.map((row) => row.kind)).toEqual(["motorway", "primary", "residential"]);
    for (const row of kinds) {
      expect(row.distanceM).toBeCloseTo(333.3, 1);
      expect(row.share).toBe(0.333);
    }
    expect(familyRows(tally)).toEqual([
      { family: "motorway", distanceM: 333.3, share: 0.333 },
      { family: "road", distanceM: 666.7, share: 0.667 },
    ]);
  });

  it("adds up the kinds of one mode or every mode, with the modes present", () => {
    const period = { from: "2026-10-19", to: "2026-10-25", days: 7 };
    const moves = [
      move("2026-10-20T06:00:00Z", "2026-10-20T07:00:00Z", {
        mode: "car",
        distanceM: 40_000,
        wayKinds: { motorway: 0.75, secondary: 0.25 },
      }),
      move("2026-10-21T06:00:00Z", "2026-10-21T06:30:00Z", {
        mode: "cycling",
        distanceM: 8000,
        wayKinds: { cycleway: 0.5, residential: 0.25, other: 0.25 },
      }),
    ];
    const input = {
      timezone: zone,
      period,
      hours: localHours(period.from, period.to, zone),
      moves,
      pending: false,
    };
    const all = buildRoads({ ...input, mode: null });
    expect(all.modes).toEqual(["cycling", "car"]);
    expect(all.distanceM).toBe(48_000);
    expect(all.kinds.map((row) => [row.kind, row.distanceM])).toEqual([
      ["motorway", 30_000],
      ["secondary", 10_000],
      ["residential", 2000],
      ["cycleway", 4000],
      ["other", 2000],
    ]);
    expect(all.families.map((row) => [row.family, row.distanceM, row.share])).toEqual([
      ["motorway", 30_000, 0.625],
      ["road", 12_000, 0.25],
      ["cycleway", 4000, 0.083],
      ["none", 2000, 0.042],
    ]);
    const cycling = buildRoads({ ...input, mode: "cycling" });
    expect(cycling.mode).toBe("cycling");
    expect(cycling.modes).toEqual(["cycling", "car"]);
    expect(cycling.mappedM).toBe(8000);
    expect(cycling.kinds.map((row) => row.share)).toEqual([0.25, 0.5, 0.25]);
  });
});

describe("when you travel", () => {
  it("fills the 168 hours of the week, for one mode or all", () => {
    const period = { from: "2026-10-19", to: "2026-10-25", days: 7 };
    const input = {
      timezone: zone,
      period,
      hours: localHours(period.from, period.to, zone),
      moves: [
        // Monday 08:30 to 09:30 local.
        move("2026-10-19T06:30:00Z", "2026-10-19T07:30:00Z", {
          mode: "cycling",
          distanceM: 15_000,
        }),
        // Saturday 14:00 to 14:30 local.
        move("2026-10-24T12:00:00Z", "2026-10-24T12:30:00Z", { mode: "walking", distanceM: 2500 }),
      ],
      pending: false,
    };
    const all = buildTimeGrid({ ...input, mode: null });
    expect(all.cells).toHaveLength(168);
    expect(all.cells[0]).toEqual({ weekday: 1, hour: 0, distanceM: 0, durationS: 0 });
    expect(all.cells[8]).toEqual({ weekday: 1, hour: 8, distanceM: 7500, durationS: 1800 });
    expect(all.cells[9]).toEqual({ weekday: 1, hour: 9, distanceM: 7500, durationS: 1800 });
    expect(all.cells[5 * 24 + 14]).toEqual({
      weekday: 6,
      hour: 14,
      distanceM: 2500,
      durationS: 1800,
    });
    expect(all.modes).toEqual(["walking", "cycling"]);
    const walking = buildTimeGrid({ ...input, mode: "walking" });
    expect(walking.cells.reduce((sum, cell) => sum + cell.durationS, 0)).toBe(1800);
    expect(walking.modes).toEqual(["walking", "cycling"]);
  });
});

describe("speeds and top moves", () => {
  it("picks the narrowest bin width that needs at most 20 bins", () => {
    expect(speedHistogram([4.2, 5.1, 3.9]).binKmh).toBe(1);
    expect(speedHistogram([4.2, 5.1, 3.9]).bins.map((bin) => bin.moves)).toEqual([
      0, 0, 0, 1, 1, 1,
    ]);
    expect(speedHistogram([18, 25, 31]).binKmh).toBe(2);
    expect(speedHistogram([95, 120]).binKmh).toBe(10);
    expect(speedHistogram([210]).binKmh).toBe(20);
    expect(speedHistogram([830]).binKmh).toBe(50);
    expect(speedHistogram([0]).bins).toEqual([{ fromKmh: 0, toKmh: 1, moves: 1 }]);
    expect(speedHistogram([]).bins).toEqual([]);
  });

  it("weights the typical speed by time and keeps the lists steady", () => {
    const moves = [
      move("2026-10-20T06:00:00Z", "2026-10-20T06:10:00Z", { medianKmh: 10, distanceM: 2000 }),
      move("2026-10-20T07:00:00Z", "2026-10-20T08:00:00Z", { medianKmh: 30, distanceM: 2000 }),
      move("2026-10-20T09:00:00Z", "2026-10-20T09:20:00Z", { medianKmh: 50, distanceM: 9000 }),
    ];
    expect(typicalSpeedKmh(moves)).toBe(30);
    expect(typicalSpeedKmh([])).toBeNull();
    const top = topMoves(moves, 2);
    expect(top.longest.map((entry) => entry.distanceM)).toEqual([9000, 2000]);
    // Equal distances: the earlier one first.
    expect(top.longest[1]?.startedAt).toBe("2026-10-20T06:00:00.000Z");
    expect(top.recent.map((entry) => entry.startedAt)).toEqual([
      "2026-10-20T09:00:00.000Z",
      "2026-10-20T07:00:00.000Z",
    ]);
  });
});
