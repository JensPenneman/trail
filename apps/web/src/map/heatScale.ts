/**
 * How the heatmap colours its cells (docs/architecture.md §14): classes of
 * point counts on a logarithmic scale of round numbers, taken from the cells
 * in view. Counts run from one point to hundreds of thousands (a night at
 * home is tens of thousands), so equal steps of the count would leave all but
 * the busiest place in the first class.
 */
export interface HeatScale {
  /**
   * The smallest count of every class, ascending: the first is the smallest
   * count in view, the last class has no upper bound. Empty when nothing is
   * in view.
   */
  readonly starts: readonly number[];
}

/** The steps of `heatRamp`, which the map and the legend draw. */
const heatShades = 6;

/** More classes than the ramp has steps would not be told apart; fewer read more easily. */
const maxClasses = heatShades;

/**
 * Where the scale ends: the busiest few per cent of the cells share the top
 * class, so that one place (home) does not stretch the scale until the rest
 * looks alike.
 */
const topQuantile = 0.97;

interface RoundSeries {
  /** The round numbers of a decade: 1, 2 and 5 make 1 2 5 10 20 50 100 … */
  mantissas: readonly number[];
  /** Every decade, or every second one (1 100 10 000 …). */
  decades: number;
  /** With up to two starts too many it keeps the highest ones rather than giving way. */
  keepsHighest?: true;
}

/** Finest first; the last always fits (counts never span ten decades). */
const roundSeries: readonly RoundSeries[] = [
  { mantissas: [1, 2, 5], decades: 1 },
  { mantissas: [1, 3], decades: 1, keepsHighest: true },
  { mantissas: [1], decades: 1 },
  { mantissas: [1], decades: 2 },
];

function seriesValues(series: RoundSeries, upTo: number): number[] {
  const values: number[] = [];
  for (let decade = 0; 10 ** decade <= upTo; decade += series.decades) {
    for (const mantissa of series.mantissas) values.push(mantissa * 10 ** decade);
  }
  return values;
}

/**
 * The classes for the counts of the cells in view (docs/architecture.md §14):
 * from the smallest count up to the busiest few per cent, the classes start
 * at the round numbers of the finest series that fits them into six classes —
 * "1–2, 3–9, 10–29, 30–99, 100–299, 300 or more". When the 1–3 series has a
 * start or two too many it keeps the highest ones, so the rarest counts share
 * the first class ("1–29") rather than the scale dropping to whole decades.
 * Panning changes the counts a little but rarely the round numbers, so the
 * colours stay put.
 */
export function heatScale(counts: readonly number[]): HeatScale {
  const sorted = counts
    .filter((count) => Number.isFinite(count) && count > 0)
    .sort((a, b) => a - b);
  const lowest = sorted[0];
  if (lowest === undefined) return { starts: [] };
  const top = sorted[Math.floor((sorted.length - 1) * topQuantile)] ?? lowest;
  const wanted = maxClasses - 1;
  let starts: number[] = [];
  for (const series of roundSeries) {
    starts = seriesValues(series, top).filter((value) => value > lowest && value <= top);
    if (starts.length <= wanted) break;
    if (series.keepsHighest === true && starts.length <= wanted + 2) {
      starts = starts.slice(-wanted);
      break;
    }
  }
  return { starts: [lowest, ...starts] };
}

/** The class of a count: 0 for the first, up to `starts.length - 1`. */
export function heatClassOf(scale: HeatScale, count: number): number {
  let index = 0;
  for (let next = 1; next < scale.starts.length; next += 1) {
    if (count >= (scale.starts[next] ?? Number.POSITIVE_INFINITY)) index = next;
  }
  return index;
}

/**
 * The ramp step (1–6) of a class among `classes`: spread over the whole ramp,
 * so that two or three classes stay far apart. A single class takes a middle
 * step, strong enough on every map, since it says nothing about more or less.
 */
export function heatShadeOf(classIndex: number, classes: number): number {
  if (classes <= 1) return Math.ceil(heatShades / 2) + 1;
  const position = Math.min(Math.max(classIndex, 0), classes - 1) / (classes - 1);
  return 1 + Math.round(position * (heatShades - 1));
}
