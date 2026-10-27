import type { ChartRow, ChartSeries } from "./chartTypes";
import { chartValue, seriesValues, sum } from "./chartValues";

/** What a chart says instead of drawing when it has nothing to draw. */
export const nothingToShow = "Nothing to show for this period.";

/** The first item with the largest value (ties go to the earliest). */
function largest<T>(items: readonly T[], value: (item: T) => number): T | undefined {
  let best: T | undefined;
  for (const item of items) {
    if (best === undefined || value(item) > value(best)) best = item;
  }
  return best;
}

/**
 * A bar chart's headline in words: the highest row and the total, and with
 * two or more series the one with the most — "Highest: Monday 26 October,
 * 42.3 km. Total 98 km. Most: Train, 61 km."
 */
export function describeBars(
  rows: readonly ChartRow[],
  series: readonly ChartSeries[],
  formatValue: (value: number) => string,
): string {
  const totals = rows.map((row) => ({ row, total: sum(seriesValues(row.values, series.length)) }));
  const total = sum(totals.map((item) => item.total));
  const highest = largest(totals, (item) => item.total);
  if (highest === undefined || total <= 0) return nothingToShow;
  const parts = [
    `Highest: ${highest.row.label}, ${formatValue(highest.total)}.`,
    `Total ${formatValue(total)}.`,
  ];
  if (series.length >= 2) {
    const bySeries = series.map((item, index) => ({
      item,
      total: sum(rows.map((row) => chartValue(row.values[index]))),
    }));
    const most = largest(bySeries, (entry) => entry.total);
    if (most !== undefined) parts.push(`Most: ${most.item.label}, ${formatValue(most.total)}.`);
  }
  return parts.join(" ");
}

/**
 * The extremes of a set of labelled values in words: "Highest: Monday,
 * 12.3 km. Lowest: Sunday, 1.2 km." For a line, a histogram's bins or a heat
 * grid's cells as well as bars.
 */
export function describeExtremes(
  items: readonly { label: string; value: number }[],
  formatValue: (value: number) => string,
): string {
  const valid = items.filter((item) => Number.isFinite(item.value));
  const highest = largest(valid, (item) => item.value);
  const lowest = largest(valid, (item) => -item.value);
  if (highest === undefined || lowest === undefined || valid.every((item) => item.value === 0)) {
    return nothingToShow;
  }
  if (valid.length === 1) return `${highest.label}: ${formatValue(highest.value)}.`;
  if (highest.value === lowest.value) return `All the same: ${formatValue(highest.value)}.`;
  return `Highest: ${highest.label}, ${formatValue(highest.value)}. Lowest: ${lowest.label}, ${formatValue(lowest.value)}.`;
}
