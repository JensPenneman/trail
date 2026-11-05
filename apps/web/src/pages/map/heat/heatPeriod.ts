import { lastInsightsDay } from "@trail/contracts/period";
import { addDays } from "../../../time/addDays";
import { parseLocalDate } from "../../../time/parseLocalDate";

/** A period of local days, both ends included. */
export interface HeatPeriod {
  from: string;
  to: string;
}

const periodPresets = ["all", "7d", "30d", "12m"] as const;
type PeriodPreset = (typeof periodPresets)[number];

/** The same date a year earlier plus a day, so that the 12 months end on `today` and count 365 or 366 days. */
function yearBefore(today: string): string {
  const parsed = parseLocalDate(today);
  if (parsed === null) return today;
  const back = new Date(Date.UTC(parsed.year - 1, parsed.month - 1, parsed.day));
  const date = `${String(back.getUTCFullYear()).padStart(4, "0")}-${String(back.getUTCMonth() + 1).padStart(2, "0")}-${String(back.getUTCDate()).padStart(2, "0")}`;
  return addDays(date, 1);
}

/** The period of a preset relative to today; null (all time) for "all". */
export function presetPeriod(preset: PeriodPreset, today: string): HeatPeriod | null {
  switch (preset) {
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "12m":
      return { from: yearBefore(today), to: today };
    default:
      return null;
  }
}

/** Which preset a period is relative to today, or "custom". */
export function presetOf(period: HeatPeriod | null, today: string): PeriodPreset | "custom" {
  if (period === null) return "all";
  for (const preset of periodPresets) {
    const found = presetPeriod(preset, today);
    if (found !== null && found.from === period.from && found.to === period.to) return preset;
  }
  return "custom";
}

/** A custom period as typed: in order, at most three years, not after today (a later day is today). */
export function resolveCustom(
  from: string,
  to: string,
  today: string,
): { period: HeatPeriod } | { error: string } {
  if (parseLocalDate(from) === null || parseLocalDate(to) === null) {
    return { error: "Enter both dates." };
  }
  const last = to > today ? today : to;
  const first = from > today ? today : from;
  if (first > last) return { error: "From must not be after To." };
  if (last > lastInsightsDay(first)) return { error: "A period can span at most 3 years." };
  return { period: { from: first, to: last } };
}
