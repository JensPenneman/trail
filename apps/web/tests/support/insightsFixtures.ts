import type {
  InsightsMode,
  InsightsMove,
  InsightsOverview,
  InsightsRoads,
  InsightsTime,
} from "@trail/contracts/insights";
import { ids } from "./fixtures";

/** Answers of the Insights operations, for a week with a train ride and a bike ride. */

const totals = (overrides: Partial<InsightsOverview["totals"]> = {}) => ({
  distanceM: 66_000,
  durationS: 4500,
  moves: 2,
  stops: 3,
  activeDays: 2,
  ...overrides,
});

export function overview(overrides: Partial<InsightsOverview> = {}): InsightsOverview {
  return {
    timezone: "Europe/Brussels",
    period: {
      from: "2026-10-20",
      to: "2026-10-26",
      days: 7,
      bucket: "day",
      buckets: [
        "2026-10-20",
        "2026-10-21",
        "2026-10-22",
        "2026-10-23",
        "2026-10-24",
        "2026-10-25",
        "2026-10-26",
      ],
    },
    previous: {
      from: "2026-10-13",
      to: "2026-10-19",
      days: 7,
      totals: totals({ distanceM: 60_000, durationS: 5000, moves: 1, stops: 3, activeDays: 1 }),
    },
    totals: totals(),
    modes: [
      {
        mode: "train",
        distanceM: 60_000,
        durationS: 2700,
        moves: 1,
        avgSpeedKmh: 80,
        share: 0.909,
        deltaDistanceM: 5000,
      },
      {
        mode: "cycling",
        distanceM: 6000,
        durationS: 1800,
        moves: 1,
        avgSpeedKmh: 12,
        share: 0.091,
        deltaDistanceM: 6000,
      },
    ],
    series: [
      { bucket: "2026-10-21", mode: "train", distanceM: 60_000, durationS: 2700 },
      { bucket: "2026-10-23", mode: "cycling", distanceM: 6000, durationS: 1800 },
    ],
    pending: false,
    ...overrides,
  };
}

export const segmentId = "019a1f7e-3c55-7b42-9d0e-5b7f3a1c2d4e";

const ride = (overrides: Partial<InsightsMove> = {}): InsightsMove => ({
  segmentId,
  deviceId: ids.phone,
  startedAt: "2026-10-21T06:42:10.000Z",
  endedAt: "2026-10-21T07:27:10.000Z",
  distanceM: 60_000,
  durationS: 2700,
  avgSpeedKmh: 80,
  maxSpeedKmh: 141.2,
  ...overrides,
});

export function modeInsights(overrides: Partial<InsightsMode> = {}): InsightsMode {
  const period = overview().period;
  return {
    timezone: "Europe/Brussels",
    mode: "train",
    period,
    totals: {
      distanceM: 60_000,
      durationS: 2700,
      moves: 1,
      avgSpeedKmh: 80,
      typicalSpeedKmh: 96.4,
      longest: ride(),
      fastest: ride(),
    },
    series: period.buckets.map((bucket) => ({
      bucket,
      distanceM: bucket === "2026-10-21" ? 60_000 : 0,
      durationS: bucket === "2026-10-21" ? 2700 : 0,
    })),
    byHour: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      distanceM: hour === 8 ? 60_000 : 0,
      durationS: hour === 8 ? 2700 : 0,
    })),
    byWeekday: Array.from({ length: 7 }, (_, index) => ({
      weekday: index + 1,
      distanceM: index === 2 ? 60_000 : 0,
      durationS: index === 2 ? 2700 : 0,
    })),
    roads: {
      distanceM: 60_000,
      mappedM: 60_000,
      kinds: [
        { kind: "residential", distanceM: 2400, share: 0.04 },
        { kind: "rail", distanceM: 57_600, share: 0.96 },
      ],
    },
    rail: { distanceM: 57_600, share: 0.96 },
    ferry: null,
    stationStops: 3,
    speedHistogram: {
      binKmh: 10,
      bins: Array.from({ length: 10 }, (_, index) => ({
        fromKmh: index * 10,
        toKmh: (index + 1) * 10,
        moves: index === 9 ? 1 : 0,
      })),
    },
    topMoves: { longest: [ride()], fastest: [ride()], recent: [ride()] },
    pending: false,
    ...overrides,
  };
}

export function timeInsights(overrides: Partial<InsightsTime> = {}): InsightsTime {
  return {
    timezone: "Europe/Brussels",
    period: { from: "2026-10-20", to: "2026-10-26", days: 7 },
    mode: null,
    modes: ["cycling", "train"],
    cells: Array.from({ length: 168 }, (_, index) => ({
      weekday: Math.floor(index / 24) + 1,
      hour: index % 24,
      distanceM: index === 2 * 24 + 8 ? 60_000 : 0,
      durationS: index === 2 * 24 + 8 ? 2700 : index === 4 * 24 + 17 ? 1800 : 0,
    })),
    pending: false,
    ...overrides,
  };
}

export function roadInsights(overrides: Partial<InsightsRoads> = {}): InsightsRoads {
  return {
    timezone: "Europe/Brussels",
    period: { from: "2026-10-20", to: "2026-10-26", days: 7 },
    mode: null,
    modes: ["cycling", "train"],
    distanceM: 66_000,
    mappedM: 66_000,
    kinds: [
      { kind: "residential", distanceM: 4400, share: 0.067 },
      { kind: "cycleway", distanceM: 4000, share: 0.061 },
      { kind: "rail", distanceM: 57_600, share: 0.873 },
    ],
    families: [
      { family: "road", distanceM: 4400, share: 0.067 },
      { family: "cycleway", distanceM: 4000, share: 0.061 },
      { family: "rail", distanceM: 57_600, share: 0.873 },
    ],
    pending: false,
    ...overrides,
  };
}
