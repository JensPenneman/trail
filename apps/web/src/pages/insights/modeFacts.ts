import type { InsightsMode } from "@trail/contracts/insights";
import type { TransportMode } from "@trail/contracts/transport";
import type { Formatter } from "../../format/createFormatter";
import { localDateOf } from "../../time/localDateOf";
import { formatKmh } from "./insightsFormat";
import { wayKindLabels } from "./wayLabels";

/** What a mode travels on, for the screen of its roads: roads and paths, rails or water; nothing for the others. */
export type ModeFamily = "road" | "rail" | "ferry";

const families: Readonly<Partial<Record<TransportMode, ModeFamily>>> = {
  walking: "road",
  running: "road",
  cycling: "road",
  car: "road",
  bus: "road",
  train: "rail",
  tram: "rail",
  metro: "rail",
  boat: "ferry",
};

export const modeFamily = (mode: TransportMode): ModeFamily | null => families[mode] ?? null;

const pad = (value: number) => String(value).padStart(2, "0");

/** The index of the largest value, or null when there is none above zero. */
function peak(values: readonly number[]): number | null {
  let best: number | null = null;
  for (const [index, value] of values.entries()) {
    if (value > 0 && (best === null || value > (values[best] ?? 0))) best = index;
  }
  return best;
}

/** The weekday and hour a mode is mostly used at. */
function busiestTimes(
  insights: InsightsMode,
  format: Formatter,
): { weekday: string; hour: number } | null {
  const day = peak(insights.byWeekday.map((entry) => entry.durationS));
  const hour = peak(insights.byHour.map((entry) => entry.durationS));
  if (day === null || hour === null) return null;
  const entry = insights.byWeekday[day];
  const name = entry === undefined ? undefined : format.weekdays(1)[entry.weekday - 1]?.long;
  return name === undefined ? null : { weekday: name, hour: insights.byHour[hour]?.hour ?? 0 };
}

/** "Mostly Mondays · 08:00" */
export function whenFact(insights: InsightsMode, format: Formatter): string | null {
  const times = busiestTimes(insights, format);
  return times === null ? null : `Mostly ${times.weekday}s · ${pad(times.hour)}:00`;
}

/** "62% on cycleways", "94% on railway track", "80% on ferry routes"; null without map data or for modes without a family. */
export function roadsFact(insights: InsightsMode, format: Formatter): string | null {
  const family = modeFamily(insights.mode);
  if (family === null || insights.roads.mappedM <= 0) return null;
  if (family === "rail") {
    return insights.rail === null
      ? null
      : `${format.percent(insights.rail.share)} on railway track`;
  }
  if (family === "ferry") {
    return insights.ferry === null
      ? null
      : `${format.percent(insights.ferry.share)} on ferry routes`;
  }
  const top = topKind(insights);
  return top === null
    ? null
    : `${format.percent(top.share)} on ${wayKindLabels[top.kind].toLowerCase()}`;
}

/** The kind of way with the most distance, "off the map" left out. */
export function topKind(insights: InsightsMode): InsightsMode["roads"]["kinds"][number] | null {
  let top: InsightsMode["roads"]["kinds"][number] | null = null;
  for (const entry of insights.roads.kinds) {
    if (entry.kind !== "other" && (top === null || entry.distanceM > top.distanceM)) top = entry;
  }
  return top;
}

/** "Typically 17 km/h" */
export function speedFact(insights: InsightsMode, format: Formatter): string | null {
  const typical = insights.totals.typicalSpeedKmh;
  return typical === null ? null : `Typically ${formatKmh(format, typical)}`;
}

/** The local day of a move, "Tue 7 Oct". */
export const moveDay = (startedAt: string, format: Formatter): string =>
  format.day(localDateOf(startedAt, format.timeZone));

/** "23.4 km · Tue 7 Oct" */
export function longestFact(insights: InsightsMode, format: Formatter): string | null {
  const longest = insights.totals.longest;
  return longest === null
    ? null
    : `${format.distance(longest.distanceM)} · ${moveDay(longest.startedAt, format)}`;
}
