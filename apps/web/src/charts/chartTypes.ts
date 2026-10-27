import type { TransportMode } from "@trail/contracts/transport";

/**
 * What colours a series: a transport mode (its `--mode-<mode>` token), the
 * accent (one series not about a mode), muted (de-emphasis, "Other"), or a
 * categorical slot for series of other things (`--chart-category-<n>`),
 * given in this order and always to the same thing, never by rank.
 */
export type ChartTone = TransportMode | "accent" | "muted" | ChartCategory;

/** The categorical slots, in their fixed order (validated as a set: tokens.css). */
type ChartCategory = "category-1" | "category-2" | "category-3";

export interface ChartSeries {
  key: string;
  label: string;
  tone: ChartTone;
}

/** One category: an x position of a vertical chart, a row of a horizontal one. */
export interface ChartRow {
  key: string;
  /** Full name, for the tooltip, the table and the mark's accessible name: "Monday 26 October". */
  label: string;
  /** Short axis label ("Mon 26"); defaults to `label`. */
  tick?: string;
  /** One value per series, in the order of `series`. */
  values: readonly number[];
  /**
   * The row's own tone, for one series whose rows are different things (a bar
   * per transport mode); with two or more series the series' tones apply.
   */
  tone?: ChartTone;
}

/** A box in the plot, in the SVG's user units (which are CSS pixels). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One line of a tooltip: the value first, then what it is. */
interface TooltipEntry {
  key: string;
  label: string;
  value: string;
  tone: ChartTone;
}

/** What a mark shows in its tooltip, and (as text) in its accessible description. */
export interface TooltipContent {
  title: string;
  entries: readonly TooltipEntry[];
  /** Two or more series: every entry is keyed with its series' colour and named. */
  keyed: boolean;
  total?: string;
}

/** A piece of text drawn in the plot (an axis label, a value at a bar's end). */
export interface PlotText {
  key: string;
  x: number;
  y: number;
  text: string;
  anchor: "start" | "middle" | "end";
}
