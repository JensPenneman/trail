import { type HeatMeasure, heatPeriodMeasures } from "@trail/contracts/heatmap";
import type { Formatter } from "../../../format/createFormatter";
import { countLadders, durationLadders, type HeatLadder } from "../../../map/heatScale";

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
  visits: {
    option: "Visits to places",
    title: "Visits to places in each square",
    ends: ["Less", "More"],
    ladders: countLadders,
  },
};

/** The measures "Heat by" offers, in order. */
export const heatChoices: readonly HeatMeasure[] = ["points", "time", "visits"];

/** Whether the measure covers a period (all but the points). */
export const hasPeriod = (heat: HeatMeasure): boolean => heatPeriodMeasures.has(heat);

/** A value of the measure in words: "1,820 points", "3 hr 20 min", "12 visits". */
export function valueText(heat: HeatMeasure, value: number, format: Formatter): string {
  if (heat === "time") return format.duration(value);
  if (heat === "visits") return `${format.count(value)} ${value === 1 ? "visit" : "visits"}`;
  return `${format.count(value)} ${value === 1 ? "point" : "points"}`;
}

const unitsS = [
  { size: 604_800, name: "wks" },
  { size: 86_400, name: "days" },
  { size: 3600, name: "hr" },
  { size: 60, name: "min" },
] as const;

/** "5–15 min", "1–3 hr", else both ends in full: the class from `from` up to (not including) `to`. */
function durationRange(from: number, to: number, format: Formatter): string {
  const unit = unitsS.find(({ size }) => to % size === 0 && from % size === 0 && to / size >= 2);
  if (unit === undefined) return `${format.roundDuration(from)}–${format.roundDuration(to)}`;
  return `${from / unit.size}–${to / unit.size} ${unit.name}`;
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
    if (heat === "time") {
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
