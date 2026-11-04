import {
  type HeatMeasure,
  heatMovementMeasures,
  heatPeriodMeasures,
} from "@trail/contracts/heatmap";
import type { Formatter } from "../../../format/createFormatter";
import {
  countLadders,
  durationLadders,
  type HeatLadder,
  speedLadders,
} from "../../../map/heatScale";

/** What the Heat controls and key say of each measure (docs/architecture.md §14). */
interface HeatMeasureInfo {
  /** The choice in "Heat by". */
  option: string;
  /** The key's title. */
  title: string;
  /** The words at the two ends of the key: less to more. */
  ends: readonly [string, string];
  /** The round numbers its classes begin at. */
  ladders: readonly HeatLadder[];
}

export const heatMeasureInfo: Readonly<Record<HeatMeasure, HeatMeasureInfo>> = {
  points: {
    option: "Points recorded",
    title: "Points recorded in each square",
    ends: ["Rarely", "Often"],
    ladders: countLadders,
  },
  time: {
    option: "Time spent at places",
    title: "Time spent at places in each square",
    ends: ["Less", "More"],
    ladders: durationLadders,
  },
  moving: {
    option: "Time on the move",
    title: "Time on the move in each square",
    ends: ["Less", "More"],
    ladders: durationLadders,
  },
  speed: {
    option: "Average speed",
    title: "Average speed in each square",
    ends: ["Slower", "Faster"],
    ladders: speedLadders,
  },
  topspeed: {
    option: "Top speed",
    title: "Top speed in each square",
    ends: ["Slower", "Faster"],
    ladders: speedLadders,
  },
  visits: {
    option: "Visits to places",
    title: "Visits to places in each square",
    ends: ["Rarely", "Often"],
    ladders: countLadders,
  },
};

/** The measures "Heat by" offers, in order. */
export const heatChoices: readonly HeatMeasure[] = [
  "points",
  "time",
  "visits",
  "moving",
  "speed",
  "topspeed",
];

/** The measures of movement: they take a mode and count what the per-day cells hold. */
export const hasMode = (heat: HeatMeasure): boolean => heatMovementMeasures.has(heat);

/** Whether the measure covers a period (all but the points). */
export const hasPeriod = (heat: HeatMeasure): boolean => heatPeriodMeasures.has(heat);

/** A value of the measure in words: "1,820 points", "3 hr 20 min", "12 visits". */
export function valueText(heat: HeatMeasure, value: number, format: Formatter): string {
  if (heat === "time" || heat === "moving") return format.duration(value);
  // Speeds are told in cm/s.
  if (heat === "speed" || heat === "topspeed") return format.speed(value / 100);
  if (heat === "visits") return `${format.count(value)} ${value === 1 ? "visit" : "visits"}`;
  return `${format.count(value)} ${value === 1 ? "point" : "points"}`;
}

const unitsS = [
  { size: 604_800, unit: "week" },
  { size: 86_400, unit: "day" },
  { size: 3600, unit: "hour" },
  { size: 60, unit: "minute" },
] as const;

/** "5–15 min", "1–3 hr" in the locale's own units, else both ends in full: the class from `from` up to `to`. */
function durationRange(from: number, to: number, format: Formatter): string {
  const found = unitsS.find(({ size }) => to % size === 0 && from % size === 0 && to / size >= 2);
  if (found === undefined) return `${format.roundDuration(from)}–${format.roundDuration(to)}`;
  return new Intl.NumberFormat(format.locale, {
    style: "unit",
    unit: found.unit,
    unitDisplay: "short",
  }).formatRange(from / found.size, to / found.size);
}

/**
 * The classes of a scale in words, one per start: counts as "1–9", "10 or more"; times as "under
 * 5 min", "5–15 min", "1 day or more".
 */
export function classLabels(
  heat: HeatMeasure,
  starts: readonly number[],
  format: Formatter,
): string[] {
  return starts.map((start, index) => {
    const next = starts[index + 1];
    if (heat === "speed" || heat === "topspeed") {
      const kmh = (value: number) => Math.round((value / 100) * 3.6);
      if (next === undefined) return `${kmh(start)} km/h or more`;
      return index === 0 ? `under ${kmh(next)} km/h` : `${kmh(start)}–${kmh(next)}`;
    }
    if (heat === "time" || heat === "moving") {
      if (next === undefined) return `${format.roundDuration(start)} or more`;
      return index === 0
        ? `under ${format.roundDuration(next)}`
        : durationRange(start, next, format);
    }
    if (next === undefined) return `${format.count(start)} or more`;
    return next - 1 === start
      ? format.count(start)
      : `${format.count(start)}–${format.count(next - 1)}`;
  });
}
