/** Bin widths to choose from, km/h: the narrowest that needs no more than `maxBins`. */
const widths = [1, 2, 5, 10, 20, 50, 100] as const;
const maxBins = 20;

export interface SpeedHistogram {
  binKmh: number;
  bins: { fromKmh: number; toKmh: number; moves: number }[];
}

/**
 * Moves by their median speed (km/h): bins of one width from 0 up to the
 * fastest move's, empty ones included, so the shape reads true. The width is
 * the narrowest of 1, 2, 5, 10, 20, 50 or 100 km/h that needs at most 20
 * bins (100 km/h when even that needs more).
 */
export function speedHistogram(speedsKmh: readonly number[]): SpeedHistogram {
  const speeds = speedsKmh.filter((speed) => Number.isFinite(speed) && speed >= 0);
  if (speeds.length === 0) return { binKmh: widths[0], bins: [] };
  const fastest = Math.max(...speeds);
  const binKmh =
    widths.find((width) => Math.floor(fastest / width) + 1 <= maxBins) ??
    widths[widths.length - 1] ??
    100;
  const bins = Array.from({ length: Math.floor(fastest / binKmh) + 1 }, (_, index) => ({
    fromKmh: index * binKmh,
    toKmh: (index + 1) * binKmh,
    moves: 0,
  }));
  for (const speed of speeds) {
    const bin = bins[Math.min(bins.length - 1, Math.floor(speed / binKmh))];
    if (bin !== undefined) bin.moves += 1;
  }
  return { binKmh, bins };
}
