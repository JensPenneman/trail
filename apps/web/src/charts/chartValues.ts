/**
 * A value as a mark can draw it. Distances, durations and counts are never
 * negative; anything that is not a finite positive number (a gap in the data,
 * NaN) draws as nothing instead of breaking the geometry.
 */
export function chartValue(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

/** A row's values ready to draw, exactly one per series. */
export function seriesValues(values: readonly number[], count: number): number[] {
  return Array.from({ length: count }, (_, index) => chartValue(values[index]));
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
