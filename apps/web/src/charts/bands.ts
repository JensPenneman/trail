import { tickStride } from "./ticks";

/** The surface showing between touching marks: stacked segments, grouped bars, histogram bins, heat cells. */
export const surfaceGap = 2;

/** Room for one category. */
interface Bands {
  /** Distance between the starts of two neighbouring bands. */
  step: number;
  /** The bar (or the group of bars) centred in each band. */
  thickness: number;
}

/**
 * Splits `length` px into `count` equal bands and sizes the bar inside each:
 * at most `maxThickness` (24 px for a bar, the mark spec), and never the whole
 * band, so what is left between bars reads as air.
 */
export function bandLayout(count: number, length: number, maxThickness = 24): Bands {
  if (count <= 0 || !(length > 0)) return { step: 0, thickness: 0 };
  const step = length / count;
  return { step, thickness: Math.max(1, Math.min(maxThickness, step * 0.62, step - 2)) };
}

/** The thickness of each of `count` bars sharing `thickness`, with the surface gap between neighbours. */
export function groupBarThickness(thickness: number, count: number): number {
  if (count <= 1) return thickness;
  return Math.max(1, (thickness - surfaceGap * (count - 1)) / count);
}

/** Where the categories of a vertical chart go along its width. */
interface CategoryAxis {
  left: number;
  right: number;
  /** Width of one band. */
  step: number;
  /** Every how many categories a label is shown. */
  stride: number;
}

/**
 * Lays out the categories of a vertical chart: the band width, how many
 * labels to skip so that none collide at this width, and margins wide enough
 * that the first and the last label shown stay inside the chart. Labels sit
 * under the band centres, or on the band edges (`edges`: a histogram's bin
 * edges, one label more than bands).
 */
export function categoryAxis(options: {
  width: number;
  left: number;
  right: number;
  /** The estimated width of every label, in order. */
  labelWidths: readonly number[];
  edges?: boolean;
  gap?: number;
}): CategoryAxis {
  const { width, labelWidths, edges = false, gap = 8 } = options;
  const bands = edges ? labelWidths.length - 1 : labelWidths.length;
  if (bands <= 0) return { left: options.left, right: options.right, step: 0, stride: 1 };
  const widest = Math.max(0, ...labelWidths);
  // Label i sits at left + step × (i + shift), the step being (width − left − right) / bands.
  const shift = edges ? 0 : 0.5;
  let left = options.left;
  let right = options.right;
  let stride = 1;
  // Each margin has a closed form given the other and the stride. A wider margin narrows the
  // bands, which may thin the labels further; the stride only ever grows, so this settles
  // (letting it shrink again could swing between two strides and leave the last label out).
  for (let round = 0; round < 12; round += 1) {
    const fitted = Math.max(stride, tickStride((width - left - right) / bands, widest, gap));
    const last = Math.floor((labelWidths.length - 1) / fitted) * fitted;
    const firstHalf = (labelWidths[0] ?? 0) / 2;
    const lastHalf = (labelWidths[last] ?? 0) / 2;
    const nextLeft = Math.max(
      options.left,
      (firstHalf - ((width - right) * shift) / bands) / (1 - shift / bands),
    );
    const reach = (last + shift) / bands;
    const nextRight =
      reach > 0
        ? Math.max(options.right, width - nextLeft - (width - nextLeft - lastHalf) / reach)
        : options.right;
    const settled =
      fitted === stride && Math.abs(nextLeft - left) < 0.01 && Math.abs(nextRight - right) < 0.01;
    stride = fitted;
    left = nextLeft;
    right = nextRight;
    if (settled) break;
  }
  left = Math.ceil(left);
  right = Math.ceil(right);
  const step = Math.max(0, width - left - right) / bands;
  return { left, right, step, stride };
}
