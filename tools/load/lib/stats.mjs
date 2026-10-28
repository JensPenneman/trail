/* Percentiles and summaries of what the probe and the collector measured. */

/**
 * The p-th percentile (0–100) of numbers, by the nearest rank of the sorted
 * values; null without values.
 * @param {readonly number[]} values
 * @param {number} p
 * @returns {number | null}
 */
function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] ?? null;
}

/**
 * Count, mean, p50/p95/p99 and max.
 * @param {readonly number[]} values
 */
export function summarize(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    n: values.length,
    mean: values.length === 0 ? null : total / values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: values.length === 0 ? null : Math.max(...values),
  };
}

/**
 * A number for a report: rounded to `digits`, or "—" when there is none.
 * @param {number | null | undefined} value
 * @param {number} [digits]
 */
export function show(value, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
