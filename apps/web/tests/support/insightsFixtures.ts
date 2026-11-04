import type {
  InsightsMode,
  InsightsMove,
  InsightsOverview,
  InsightsPlace,
  InsightsPlaces,
  InsightsRoads,
  InsightsTime,
  PlaceSummary,
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

/** The days of a month as the API's series period: every day a step. */
export function monthPeriod(month: string): InsightsOverview["period"] {
  const [year = 0, number = 1] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const buckets = Array.from(
    { length: days },
    (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`,
  );
  return {
    from: `${month}-01`,
    to: `${month}-${String(days).padStart(2, "0")}`,
    days,
    bucket: "day",
    buckets,
  };
}

/** October 2026: the week's train and bike ride, over a month. */
export function octoberOverview(overrides: Partial<InsightsOverview> = {}): InsightsOverview {
  return overview({ period: monthPeriod("2026-10"), ...overrides });
}

/** September 2026: more walking, a little less train, no cycling. */
export function septemberOverview(overrides: Partial<InsightsOverview> = {}): InsightsOverview {
  return overview({
    period: monthPeriod("2026-09"),
    totals: totals({ distanceM: 60_000, durationS: 6000, moves: 3, stops: 4, activeDays: 3 }),
    modes: [
      {
        mode: "train",
        distanceM: 50_000,
        durationS: 2700,
        moves: 1,
        avgSpeedKmh: 66,
        share: 0.833,
        deltaDistanceM: 0,
      },
      {
        mode: "walking",
        distanceM: 10_000,
        durationS: 3300,
        moves: 2,
        avgSpeedKmh: 5,
        share: 0.167,
        deltaDistanceM: 0,
      },
    ],
    series: [],
    ...overrides,
  });
}

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
  const period = overrides.period ?? overview().period;
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

/** Four places: a stop, near one, a road and one without a name. */
export const placeKeys = {
  station: "134217.89012",
  square: "134220.89012",
  street: "134300.89100",
  unnamed: "134400.89200",
} as const;

const placeSummary = (
  key: string,
  name: PlaceSummary["name"],
  durationS: number,
  visits: number,
): PlaceSummary => ({
  key,
  centre: [3.7104, 51.0362],
  name,
  durationS,
  visits,
  days: 9,
  firstAt: "2026-10-02T06:30:00.000Z",
  lastAt: "2026-10-28T17:45:00.000Z",
});

export function placesAnswer(overrides: Partial<InsightsPlaces> = {}): InsightsPlaces {
  return {
    timezone: "Europe/Brussels",
    period: { from: "2026-10-01", to: "2026-10-31", days: 31 },
    totals: { places: 16, durationS: 360_000, visits: 28 },
    places: [
      placeSummary(
        placeKeys.station,
        { text: "Gent-Sint-Pieters", source: "stop", kind: "station", distanceM: 12 },
        43_200,
        9,
      ),
      placeSummary(
        placeKeys.square,
        { text: "Korenmarkt", source: "stop", kind: "tram_stop", distanceM: 80 },
        36_000,
        7,
      ),
      placeSummary(
        placeKeys.street,
        { text: "Kerkstraat", source: "road", kind: null, distanceM: 0 },
        7200,
        3,
      ),
      placeSummary(placeKeys.unnamed, null, 3600, 6),
    ],
    rest: { places: 12, durationS: 14_400, visits: 3 },
    pending: false,
    ...overrides,
  };
}

export function placeAnswer(overrides: Partial<InsightsPlace> = {}): InsightsPlace {
  const period = monthPeriod("2026-10");
  const day = (date: string, durationS: number, visits: number) => ({
    date,
    durationS,
    visits,
    firstAt: `${date}T06:30:00.000Z`,
    lastAt: `${date}T17:45:00.000Z`,
  });
  return {
    timezone: "Europe/Brussels",
    period,
    place: {
      ...placeSummary(
        placeKeys.station,
        { text: "Gent-Sint-Pieters", source: "stop", kind: "station", distanceM: 12 },
        43_200,
        9,
      ),
      cells: 1,
    },
    series: period.buckets.map((bucket) => ({
      bucket,
      durationS: bucket.endsWith("-28") ? 33_120 : 0,
      visits: bucket.endsWith("-28") ? 2 : 0,
    })),
    days: [
      day("2026-10-28", 33_120, 2),
      day("2026-10-27", 3600, 1),
      day("2026-10-24", 1800, 1),
      day("2026-10-20", 1800, 1),
      day("2026-10-14", 1800, 1),
      day("2026-10-09", 900, 1),
      day("2026-10-05", 900, 1),
      day("2026-10-03", 600, 1),
      day("2026-10-02", 600, 1),
    ],
    pending: false,
    ...overrides,
  };
}
