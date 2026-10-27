import { useId, useMemo } from "react";
import { useFormatter } from "../format/useFormatter";
import { categoryAxis, surfaceGap } from "./bands";
import { barPath } from "./barPath";
import { ChartFigure } from "./ChartFigure";
import { ChartPlot } from "./ChartPlot";
import { ChartTable } from "./ChartTable";
import { ChartTooltip } from "./ChartTooltip";
import type { ChartTone, PlotText, Rect } from "./chartTypes";
import { chartValue } from "./chartValues";
import { FocusRing } from "./FocusRing";
import { MarkTarget } from "./MarkTarget";
import { linearScale } from "./scales";
import { textWidth } from "./textWidth";
import { niceTicks } from "./ticks";
import { toneClass } from "./tones";
import { useChartMarks } from "./useChartMarks";
import { useChartWidth } from "./useChartWidth";
import { type AxisTick, ValueAxis } from "./ValueAxis";
import "./Histogram.css";

interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

interface HistogramProps {
  title: string;
  /** The one-line summary in words under the title: the figure's description. */
  summary: string;
  /** Neighbouring bins in order, `to` of one the `from` of the next. */
  bins: readonly HistogramBin[];
  tone: ChartTone;
  /** A bin edge on the axis: "20". */
  formatEdge: (edge: number) => string;
  /** A whole bin, for its tooltip, name and table row: "20–30 km/h". */
  formatBin: (from: number, to: number) => string;
  /** "3 rides". */
  formatCount: (count: number) => string;
  /** Names the x axis: "Median speed, km/h". */
  xLabel: string;
  /** Heads the table's count column: "Moves". */
  countLabel: string;
  /** The count axis' labels; plain whole numbers by default. */
  formatCountTick?: (count: number) => string;
  /** The summary of the table's disclosure; "Show the numbers" by default. */
  tableLabel?: string;
}

/** The chart's height, the x axis' labels included. */
const histogramHeight = 220;

interface HistogramModel {
  plot: Rect;
  ticks: AxisTick[];
  offset: number;
  bars: { key: string; path: string }[];
  labels: PlotText[];
  /** Per bin: the hit target, the hover wash, the focus ring (outside the bin) and the tooltip's anchor. */
  bands: { hit: Rect; band: Rect; ring: Rect; anchor: Rect }[];
}

function histogramModel(input: {
  width: number;
  small: number;
  keys: readonly string[];
  counts: readonly number[];
  max: number;
  edgeLabels: readonly string[];
  formatCountTick: (count: number) => string;
}): HistogramModel {
  const { width, small, keys, counts } = input;
  const top = Math.ceil(small * 0.85);
  const bottom = Math.ceil(small * 2.5);
  const plotHeight = histogramHeight - top - bottom;
  const tickValues = niceTicks(input.max, Math.min(6, Math.max(2, Math.round(plotHeight / 48))), {
    integer: true,
  });
  const tickLabels = tickValues.map((value) => input.formatCountTick(value));
  const offset = Math.round(small * 0.66);
  const yAxis =
    Math.ceil(Math.max(0, ...tickLabels.map((label) => textWidth(label, small)))) + offset + 2;
  const across = categoryAxis({
    width,
    left: yAxis,
    right: 2,
    labelWidths: input.edgeLabels.map((label) => textWidth(label, small)),
    edges: true,
  });
  const plot = { x: across.left, y: top, width: across.step * counts.length, height: plotHeight };
  const base = top + plotHeight;
  const y = linearScale([0, tickValues.at(-1) ?? 1], [base, top]);
  const bars: HistogramModel["bars"] = [];
  const bands: HistogramModel["bands"] = [];
  for (const [index, count] of counts.entries()) {
    const x = plot.x + index * across.step;
    const end = y(count);
    // Bins touch: only the 2 px surface gap between them, half on each side.
    if (count > 0) {
      bars.push({
        key: keys[index] ?? String(index),
        path: barPath(
          {
            x: x + surfaceGap / 2,
            y: end,
            width: Math.max(1, across.step - surfaceGap),
            height: base - end,
          },
          "top",
        ),
      });
    }
    bands.push({
      hit: { x, y: 0, width: across.step, height: histogramHeight },
      band: { x, y: top, width: across.step, height: plotHeight },
      ring: { x: x - 4, y: top - 4, width: across.step + 8, height: plotHeight + 8 },
      anchor: { x, y: end, width: across.step, height: base - end },
    });
  }
  return {
    plot,
    ticks: tickValues.map((value, index) => ({
      value,
      position: y(value),
      label: tickLabels[index] ?? "",
    })),
    offset,
    bars,
    labels: input.edgeLabels.flatMap((text, index) =>
      index % across.stride === 0
        ? [
            {
              key: `edge:${index}`,
              x: plot.x + index * across.step,
              y: base + Math.round(small * 0.66),
              text,
              anchor: "middle" as const,
            },
          ]
        : [],
    ),
    bands,
  };
}

/**
 * How many fall in each range: touching bins with the 2 px surface gap, the
 * bin edges along the axis (thinned to fit), counts up the side. Every bin is
 * a mark named by its range and described by its count, one tab stop for the
 * lot; the table lists them all.
 */
export function Histogram({
  title,
  summary,
  bins,
  tone,
  formatEdge,
  formatBin,
  formatCount,
  xLabel,
  countLabel,
  formatCountTick,
  tableLabel = "Show the numbers",
}: HistogramProps) {
  const format = useFormatter();
  const { measure, width, rem } = useChartWidth();
  const id = useId();
  const counts = useMemo(() => bins.map((bin) => chartValue(bin.count)), [bins]);
  const keys = useMemo(() => bins.map((bin) => `${bin.from}:${bin.to}`), [bins]);
  const names = useMemo(() => bins.map((bin) => formatBin(bin.from, bin.to)), [bins, formatBin]);
  const max = Math.max(0, ...counts);
  const model = useMemo(() => {
    const first = bins[0];
    if (max <= 0 || first === undefined) return null;
    return histogramModel({
      width,
      small: rem * 0.75,
      keys,
      counts,
      max,
      edgeLabels: [formatEdge(first.from), ...bins.map((bin) => formatEdge(bin.to))],
      formatCountTick: formatCountTick ?? ((count) => format.count(count)),
    });
  }, [bins, max, width, rem, keys, counts, formatEdge, formatCountTick, format]);
  const marks = useChartMarks(model === null ? 0 : bins.length);

  if (model === null) {
    return (
      <ChartFigure title={title} summary={summary} empty className="histogram">
        {null}
      </ChartFigure>
    );
  }
  const shown = marks.shown === null ? undefined : model.bands[marks.shown];
  const focused = marks.focused === null ? undefined : model.bands[marks.focused];
  const shownCount = marks.shown === null ? undefined : counts[marks.shown];
  const shownName = marks.shown === null ? undefined : names[marks.shown];
  return (
    <ChartFigure title={title} summary={summary} empty={false} className="histogram">
      <ChartPlot
        label={title}
        width={width}
        height={histogramHeight}
        measure={measure}
        onPointerLeave={marks.onPointerLeave}
        descriptions={counts.map((count, index) => ({
          id: `${id}d${index}`,
          text: formatCount(count),
        }))}
        tooltip={
          shown === undefined || shownCount === undefined || shownName === undefined ? null : (
            <ChartTooltip
              content={{
                title: shownName,
                keyed: false,
                entries: [
                  { key: "count", label: countLabel, value: formatCount(shownCount), tone },
                ],
              }}
              anchor={shown.anchor}
              bounds={{ width, height: histogramHeight }}
              sides={["right", "left", "top"]}
              level={model.plot.y}
            />
          )
        }
      >
        <svg className="chart__layer" aria-hidden="true">
          {shown === undefined ? null : <rect className="chart__band" {...shown.band} rx={4} />}
          <ValueAxis
            orientation="vertical"
            ticks={model.ticks}
            plot={model.plot}
            offset={model.offset}
          />
          <g className={toneClass(tone)}>
            {model.bars.map((bar) => (
              <path key={bar.key} className="chart__mark" d={bar.path} />
            ))}
          </g>
          {model.labels.map((label) => (
            <text
              key={label.key}
              className="chart__tick"
              x={label.x}
              y={label.y}
              dy="0.71em"
              textAnchor={label.anchor}
            >
              {label.text}
            </text>
          ))}
        </svg>
        <g>
          {model.bands.map((band, index) => (
            <MarkTarget
              key={keys[index]}
              rect={band.hit}
              label={names[index] ?? ""}
              describedBy={`${id}d${index}`}
              handlers={marks.markProps(index)}
            />
          ))}
        </g>
        {focused === undefined ? null : <FocusRing rect={focused.ring} />}
      </ChartPlot>
      <p className="histogram__axis-label">{xLabel}</p>
      <ChartTable
        label={tableLabel}
        caption={title}
        columns={[
          { key: "bin", label: xLabel },
          { key: "count", label: countLabel, numeric: true },
        ]}
        rows={bins.map((bin, index) => ({
          key: keys[index] ?? `${bin.from}:${bin.to}`,
          cells: [names[index], formatCount(counts[index] ?? 0)],
        }))}
      />
    </ChartFigure>
  );
}
