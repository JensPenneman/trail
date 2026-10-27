const stepFactors = [1, 2, 5, 10];

/**
 * Round tick values from 0 up to at least `max`, about `approxCount` steps of
 * 1, 2 or 5 × 10ⁿ apart, so an axis reads 0 / 5K / 10K rather than
 * 0 / 4,115 / 8,230. Nothing to show (0, a negative number, NaN) still gives
 * a usable 0–1 axis; `integer` keeps the steps whole, for counts.
 */
export function niceTicks(
  max: number,
  approxCount: number,
  options: { integer?: boolean } = {},
): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const count = Math.max(1, Math.round(Number.isFinite(approxCount) ? approxCount : 1));
  const power = 10 ** Math.floor(Math.log10(max / count));
  if (!(power > 0)) return [0, 1];
  let step = 1;
  let intervals = Math.ceil(max - 1e-9);
  let miss = Number.POSITIVE_INFINITY;
  for (const factor of stepFactors) {
    const candidate = factor * power;
    if (options.integer === true && candidate < 1) continue;
    // The tolerance absorbs float noise: 1.1 / 0.1 is 11.000000000000002, still 11 steps.
    const needed = Math.ceil(max / candidate - 1e-9);
    const off = Math.abs(needed - count);
    // Equally close: fewer labels read calmer; as few: the lower top fits the data tighter.
    if (off < miss || (off === miss && needed < intervals)) {
      miss = off;
      step = candidate;
      intervals = needed;
    }
  }
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Array.from({ length: intervals + 1 }, (_, index) =>
    Number((index * step).toFixed(decimals)),
  );
}

/** Strides that keep labels on round positions: every 2nd, 3rd or 6th hour, every 7th day, every 12th month. */
const strides = [1, 2, 3, 4, 6, 7, 12, 14, 24, 28, 30, 48, 60, 90, 120, 180, 365];

/**
 * Every how many categories an axis label is shown, so that labels
 * `labelWidth` px wide whose positions are `step` px apart keep at least `gap`
 * px between them (24 hours on a phone: every 3rd).
 */
export function tickStride(step: number, labelWidth: number, gap = 8): number {
  if (!(step > 0)) return 1;
  const needed = labelWidth + gap;
  for (const stride of strides) {
    if (stride * step >= needed) return stride;
  }
  return Math.ceil(needed / step);
}
