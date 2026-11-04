import type { Formatter } from "../../../format/createFormatter";
import { parseLocalDate } from "../../../time/parseLocalDate";
import type { HeatPeriod } from "./heatPeriod";

const lastDay = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * What a key says a period covers: "Since 4 Nov 2023" for all time, "1–31 Oct 2026" within a month,
 * else as the chip says it.
 */
export function periodDetail(period: HeatPeriod, allTime: boolean, format: Formatter): string {
  if (allTime) return `Since ${format.date(period.from)}`;
  const from = parseLocalDate(period.from);
  const to = parseLocalDate(period.to);
  if (from !== null && to !== null && from.year === to.year && from.month === to.month) {
    return `${from.day}–${format.date(period.to)}`;
  }
  return periodLabel(period, format);
}

/**
 * A period in words: the month's name for a whole month ("October 2026"), the year for a whole
 * year ("2026"), else "1 Oct – 15 Oct 2026" (the year once when both ends have it).
 */
export function periodLabel(period: HeatPeriod, format: Formatter): string {
  const from = parseLocalDate(period.from);
  const to = parseLocalDate(period.to);
  if (from === null || to === null) return `${period.from} – ${period.to}`;
  if (
    from.year === to.year &&
    from.day === 1 &&
    from.month === 1 &&
    to.month === 12 &&
    to.day === 31
  ) {
    return String(from.year);
  }
  if (
    from.year === to.year &&
    from.month === to.month &&
    from.day === 1 &&
    to.day === lastDay(to.year, to.month)
  ) {
    return format.month(from.year, from.month);
  }
  const end = format.date(period.to);
  const start =
    from.year === to.year
      ? format.date(period.from).replace(/\s*\d{4}$/, "")
      : format.date(period.from);
  return `${start} – ${end}`;
}
