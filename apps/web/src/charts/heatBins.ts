/** The heat ramp has five shades (`--heat-1` … `--heat-5`); `--heat-0` is an empty cell. */
const shades = 5;

/** How many bins a heat grid uses: a whole number from 1 to 5, five unless asked otherwise. */
export function heatSteps(steps = shades): number {
  return Number.isFinite(steps) ? Math.min(shades, Math.max(1, Math.round(steps))) : shades;
}

/** The bin of `value` among `steps` equal bins of (0, max]: 0 for nothing, else 1 … steps. */
export function heatBin(value: number, max: number, steps: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || value <= 0 || max <= 0) return 0;
  // The tolerance keeps a value on a bin's upper bound in that bin despite float noise.
  return Math.min(steps, Math.max(1, Math.ceil((value / max) * steps - 1e-9)));
}

/** The upper bound of every bin: (0, b₁], (b₁, b₂], …, (bₙ₋₁, max]. */
export function heatBounds(max: number, steps: number): number[] {
  return Array.from({ length: steps }, (_, index) => (max * (index + 1)) / steps);
}

/** The shade (1–5) of bin `bin` of `steps`, spread over the ramp so that few bins stay far apart. */
export function heatShade(bin: number, steps: number): number {
  if (bin <= 0) return 0;
  if (steps <= 1) return shades;
  return Math.round(1 + ((Math.min(bin, steps) - 1) * (shades - 1)) / (steps - 1));
}

/**
 * The most bins, up to `steps`, whose bounds still read differently through
 * `formatValue`: a formatter that rounds (minutes, whole counts) would
 * otherwise give a legend of "Up to 0 min", "1 min–1 min".
 */
export function legibleHeatSteps(
  max: number,
  steps: number,
  formatValue: (value: number) => string,
): number {
  for (let candidate = steps; candidate > 1; candidate -= 1) {
    const labels = [0, ...heatBounds(max, candidate)].map((bound) => formatValue(bound));
    if (labels.every((label, index) => index === 0 || label !== labels[index - 1]))
      return candidate;
  }
  return 1;
}
