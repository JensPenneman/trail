/**
 * The `q`-quantile of `values` weighted by `weights` (both the same length):
 * the smallest value whose cumulative weight reaches q of the total. Ties keep
 * their input order, so the result is deterministic. NaN for no weight.
 */
export function weightedQuantile(
  values: readonly number[],
  weights: readonly number[],
  q: number,
): number {
  const order = values.map((_, index) => index);
  order.sort((a, b) => (values[a] ?? 0) - (values[b] ?? 0) || a - b);
  let total = 0;
  for (const weight of weights) total += weight;
  if (!(total > 0)) return Number.NaN;
  const target = q * total;
  let cumulative = 0;
  for (const index of order) {
    cumulative += weights[index] ?? 0;
    if (cumulative >= target - 1e-9) return values[index] ?? Number.NaN;
  }
  return values[order.at(-1) ?? 0] ?? Number.NaN;
}
