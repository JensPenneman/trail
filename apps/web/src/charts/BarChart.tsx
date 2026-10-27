import { useId, useMemo } from "react";
import { bandLayout, categoryAxis, groupBarThickness, surfaceGap } from "./bands";
import { barPath } from "./barPath";
import { ChartFigure } from "./ChartFigure";
import { ChartPlot } from "./ChartPlot";
import { ChartTable } from "./ChartTable";
import { ChartTooltip } from "./ChartTooltip";
import type { ChartRow, ChartSeries, PlotText, Rect, TooltipContent } from "./chartTypes";
import { seriesValues, sum } from "./chartValues";
import { FocusRing } from "./FocusRing";
import { Legend } from "./Legend";
import { MarkTarget } from "./MarkTarget";
import { markDescription } from "./markDescription";
import { linearScale } from "./scales";
import { stackPieces } from "./stackPieces";
import { TexturePattern } from "./TexturePattern";
import { textureStyle } from "./textures";
import { fitText, textWidth } from "./textWidth";
import { niceTicks } from "./ticks";
import { toneClass } from "./tones";
import type { TooltipSide } from "./tooltipPlacement";
import { useChartMarks } from "./useChartMarks";
import { useChartWidth } from "./useChartWidth";
import { type AxisTick, ValueAxis } from "./ValueAxis";

interface BarChartProps {
  title: string;
  /** The one-line summary in words under the title: the figure's description. */
  summary: string;
  series: readonly ChartSeries[];
  rows: readonly ChartRow[];
  /** `stacked`: one bar per row, the series bottom-up (left to right); `grouped`: side by side. */
  layout?: "stacked" | "grouped";
  orientation?: "vertical" | "horizontal";
  formatValue: (value: number) => string;
  /** The value axis' labels, e.g. a compact "10 km"; `formatValue` by default. */
  formatTick?: (value: number) => string;
  /** Values at the bar ends: always on horizontal bars, on columns only where every label fits. */
  valueLabels?: boolean;
  /** The summary of the table's disclosure; "Show the numbers" by default. */
  tableLabel?: string;
  /** The table's header over the row names ("Day"); the corner stays empty without one. */
  categoryLabel?: string;
  /** A total in the tooltips, the marks' descriptions and the table; by default for stacks of two or more series. */
  totals?: boolean;
}

/** A vertical chart's height, the x axis' labels included, so its card never scrolls. */
const columnChartHeight = 240;
/** A horizontal bar's row: a 44 px target. */
const rowHeight = 44;

interface BarMark {
  /** The whole band: the hit target. */
  hit: Rect;
  /** The hover wash behind the bars. */
  band: Rect;
  /** The focus ring: around the bars with room to spare, so it never covers them, however thin. */
  ring: Rect;
  /** The bars drawn, which the tooltip sits beside. */
  anchor: Rect;
}

interface BarModel {
  height: number;
  plot: Rect;
  axis: { orientation: "vertical" | "horizontal"; ticks: AxisTick[]; offset: number } | null;
  marks: BarMark[];
  /** The bars of each series, in series order: one path per row with a value. */
  bars: { key: string; path: string }[][];
  labels: PlotText[];
  values: PlotText[];
  /** Value labels on grouped bars use the smaller size. */
  smallValues: boolean;
  sides: readonly TooltipSide[];
  /** Where a tooltip beside a column starts: the plot's top. */
  level?: number;
}

interface BarInput {
  width: number;
  /** Text sizes, from the root font size: axis labels, then row labels and values. */
  small: number;
  regular: number;
  rows: readonly ChartRow[];
  seriesCount: number;
  values: readonly (readonly number[])[];
  totals: readonly number[];
  max: number;
  stacked: boolean;
  formatValue: (value: number) => string;
  formatTick: (value: number) => string;
  valueLabels: boolean;
}

const tickCount = (length: number, spacing: number): number =>
  Math.min(6, Math.max(2, Math.round(length / spacing)));

/** Columns: values up a y axis with gridlines, categories along the bottom, thinned to fit. */
function columnModel(input: BarInput): BarModel {
  const { width, small, rows, seriesCount, values, totals, stacked } = input;
  const top = Math.ceil(input.valueLabels ? small * 2 : small * 0.85);
  const bottom = Math.ceil(small * 2.5);
  const plotHeight = columnChartHeight - top - bottom;
  const tickValues = niceTicks(input.max, tickCount(plotHeight, 48));
  const tickLabels = tickValues.map((value) => input.formatTick(value));
  const offset = Math.round(small * 0.66);
  const yAxis =
    Math.ceil(Math.max(0, ...tickLabels.map((label) => textWidth(label, small)))) + offset + 2;
  const names = rows.map((row) => row.tick ?? row.label);
  const across = categoryAxis({
    width,
    left: yAxis,
    right: 4,
    labelWidths: names.map((name) => textWidth(name, small)),
  });
  const plot = { x: across.left, y: top, width: across.step * rows.length, height: plotHeight };
  const base = top + plotHeight;
  const y = linearScale([0, tickValues.at(-1) ?? 1], [base, top]);
  const bands = bandLayout(
    rows.length,
    plot.width,
    stacked ? 24 : seriesCount * 24 + (seriesCount - 1) * surfaceGap,
  );
  const barWidth = stacked ? bands.thickness : groupBarThickness(bands.thickness, seriesCount);
  // Bars a pixel thin no longer fit their gaps: the gaps give way, so a group never leaves its band.
  const gap =
    stacked || seriesCount < 2
      ? 0
      : Math.max(
          0,
          Math.min(surfaceGap, (bands.step - 1 - seriesCount * barWidth) / (seriesCount - 1)),
        );
  const drawn = stacked ? bands.thickness : seriesCount * barWidth + (seriesCount - 1) * gap;
  const bars: { key: string; path: string }[][] = Array.from({ length: seriesCount }, () => []);
  const marks: BarMark[] = [];
  const labels: PlotText[] = [];
  const valueTexts: (PlotText & { room: number })[] = [];
  for (const [index, row] of rows.entries()) {
    const bandX = plot.x + index * bands.step;
    const start = bandX + (bands.step - drawn) / 2;
    const rowValues = values[index] ?? [];
    let reach = base;
    if (stacked) {
      const pieces = stackPieces(rowValues, y);
      for (const [order, piece] of pieces.entries()) {
        bars[piece.series]?.push({
          key: row.key,
          path: barPath(
            { x: start, y: piece.end, width: barWidth, height: piece.start - piece.end },
            order === pieces.length - 1 ? "top" : "none",
          ),
        });
      }
      const total = totals[index] ?? 0;
      reach = y(total);
      if (total > 0) {
        valueTexts.push({
          key: row.key,
          x: bandX + bands.step / 2,
          y: reach - Math.round(small * 0.5),
          text: input.formatValue(total),
          anchor: "middle",
          room: bands.step - 2,
        });
      }
    } else {
      for (const [series, value] of rowValues.entries()) {
        if (value <= 0) continue;
        const x = start + series * (barWidth + gap);
        const end = y(value);
        bars[series]?.push({
          key: row.key,
          path: barPath({ x, y: end, width: barWidth, height: base - end }, "top"),
        });
        reach = Math.min(reach, end);
        valueTexts.push({
          key: `${row.key}:${series}`,
          x: x + barWidth / 2,
          y: end - Math.round(small * 0.5),
          text: input.formatValue(value),
          anchor: "middle",
          room: barWidth + gap,
        });
      }
    }
    if (index % across.stride === 0) {
      labels.push({
        key: row.key,
        x: bandX + bands.step / 2,
        y: base + Math.round(small * 0.66),
        text: names[index] ?? "",
        anchor: "middle",
      });
    }
    // The wash and the ring hug the bars (a wide band would make them a block); the target stays the band.
    const hug = Math.min(bands.step, drawn + 16);
    const hugX = bandX + (bands.step - hug) / 2;
    const ringWidth = drawn + 10;
    marks.push({
      hit: { x: bandX, y: 0, width: bands.step, height: columnChartHeight },
      band: { x: hugX, y: top, width: hug, height: plotHeight },
      ring: {
        x: bandX + (bands.step - ringWidth) / 2,
        y: top - 4,
        width: ringWidth,
        height: plotHeight + 8,
      },
      anchor: { x: hugX, y: reach, width: hug, height: base - reach },
    });
  }
  // Labels on columns only when every one fits its band (some labels and not others would
  // mislead); without them the room kept above the columns goes back to the plot.
  if (input.valueLabels && !valueTexts.every((text) => textWidth(text.text, small) <= text.room)) {
    return columnModel({ ...input, valueLabels: false });
  }
  return {
    height: columnChartHeight,
    plot,
    axis: {
      orientation: "vertical",
      offset,
      ticks: tickValues.map((value, index) => ({
        value,
        position: y(value),
        label: tickLabels[index] ?? "",
      })),
    },
    marks,
    bars,
    labels,
    values: input.valueLabels ? valueTexts : [],
    smallValues: true,
    sides: ["right", "left", "top"],
    level: top,
  };
}

/** Horizontal bars: a row each with its name on the left, values at the ends or on an axis below. */
function barModel(input: BarInput): BarModel {
  const { width, small, regular, rows, seriesCount, values, totals, stacked } = input;
  const grouped = !stacked && seriesCount > 1;
  const thickness = grouped ? (input.valueLabels ? 14 : 12) : 20;
  const groupHeight = grouped
    ? seriesCount * thickness + (seriesCount - 1) * surfaceGap
    : thickness;
  const step = Math.max(rowHeight, groupHeight + 16);
  const valueSize = grouped ? small : regular;
  const valueTexts = input.valueLabels
    ? grouped
      ? values.flatMap((row) => row.filter((value) => value > 0))
      : totals.filter((total) => total > 0)
    : [];
  const valueRoom = Math.ceil(
    Math.max(0, ...valueTexts.map((value) => textWidth(input.formatValue(value), valueSize))),
  );
  const names = rows.map((row) => row.tick ?? row.label);
  const widest = Math.max(0, ...names.map((name) => textWidth(name, regular)));
  const layoutFor = (ticks: readonly number[]) => {
    const lastTick = textWidth(input.formatTick(ticks.at(-1) ?? 0), small);
    const right = input.valueLabels ? valueRoom + 10 : Math.ceil(lastTick / 2) + 4;
    // Names get up to 38 % of the width (cut short with an ellipsis), the bars at least 80 px.
    const labelColumn = Math.max(40, Math.min(widest, width * 0.38, width - right - 12 - 80));
    const left = Math.ceil(labelColumn) + 12;
    return { right, labelColumn, left, plotWidth: Math.max(0, width - left - right) };
  };
  const crowded = (ticks: readonly number[], plotWidth: number) =>
    plotWidth / (ticks.length - 1) <
    Math.max(...ticks.map((value) => textWidth(input.formatTick(value), small))) + 12;
  let approx = tickCount(width, 110);
  let tickValues = input.valueLabels ? [] : niceTicks(input.max, approx);
  let layout = layoutFor(tickValues);
  // Fewer gridlines when their labels would touch.
  while (approx > 1 && tickValues.length > 2 && crowded(tickValues, layout.plotWidth)) {
    approx -= 1;
    tickValues = niceTicks(input.max, approx);
    layout = layoutFor(tickValues);
  }
  const { labelColumn, left } = layout;
  const plot = { x: left, y: 2, width: layout.plotWidth, height: rows.length * step };
  const domainMax = input.valueLabels ? input.max : (tickValues.at(-1) ?? 1);
  const x = linearScale([0, domainMax], [left, left + plot.width]);
  const offset = Math.round(small * 0.66);
  const axisBand = input.valueLabels ? 0 : Math.ceil(small * 2.4);
  const height = plot.y + plot.height + axisBand + 2;
  const bars: { key: string; path: string }[][] = Array.from({ length: seriesCount }, () => []);
  const marks: BarMark[] = [];
  const labels: PlotText[] = [];
  const valueLabels: PlotText[] = [];
  for (const [index, row] of rows.entries()) {
    const rowY = plot.y + index * step;
    const centre = rowY + step / 2;
    const rowValues = values[index] ?? [];
    let anchor: Rect;
    if (grouped) {
      const groupY = centre - groupHeight / 2;
      let reach = left;
      for (const [series, value] of rowValues.entries()) {
        if (value <= 0) continue;
        const barY = groupY + series * (thickness + surfaceGap);
        const end = x(value);
        bars[series]?.push({
          key: row.key,
          path: barPath({ x: left, y: barY, width: end - left, height: thickness }, "right"),
        });
        reach = Math.max(reach, end);
        const text = input.formatValue(value);
        valueLabels.push({
          key: `${row.key}:${series}`,
          x: end + 6,
          y: barY + thickness / 2,
          text,
          anchor: "start",
        });
        if (input.valueLabels) reach = Math.max(reach, end + 6 + textWidth(text, valueSize));
      }
      // The tooltip keeps clear of the values at the bar ends.
      anchor = { x: left, y: groupY, width: reach - left, height: groupHeight };
    } else {
      const barY = centre - thickness / 2;
      const pieces = stackPieces(rowValues, x);
      for (const [order, piece] of pieces.entries()) {
        bars[piece.series]?.push({
          key: row.key,
          path: barPath(
            { x: piece.start, y: barY, width: piece.end - piece.start, height: thickness },
            order === pieces.length - 1 ? "right" : "none",
          ),
        });
      }
      const total = totals[index] ?? 0;
      let reach = x(total);
      if (total > 0) {
        const text = input.formatValue(total);
        valueLabels.push({ key: row.key, x: reach + 6, y: centre, text, anchor: "start" });
        // The tooltip keeps clear of the value at the bar's end.
        if (input.valueLabels) reach += 6 + textWidth(text, valueSize);
      }
      anchor = { x: left, y: barY, width: reach - left, height: thickness };
    }
    labels.push({
      key: row.key,
      x: 0,
      y: centre,
      text: fitText(names[index] ?? "", labelColumn, regular),
      anchor: "start",
    });
    const band = { x: 0, y: rowY, width, height: step };
    // Rows are tall enough for the ring to sit inside them, clear of the bar.
    marks.push({
      hit: band,
      band,
      ring: { x: 2, y: rowY + 2, width: width - 4, height: step - 4 },
      anchor,
    });
  }
  return {
    height,
    plot,
    axis: input.valueLabels
      ? null
      : {
          orientation: "horizontal",
          offset,
          ticks: tickValues.map((value) => ({
            value,
            position: x(value),
            label: input.formatTick(value),
          })),
        },
    marks,
    bars,
    labels,
    values: input.valueLabels ? valueLabels : [],
    smallValues: grouped,
    sides: ["right", "bottom", "top"],
  };
}

/** A row's tooltip: every series with a value (all of them side by side), and the total. */
function rowContent(
  row: ChartRow,
  series: readonly ChartSeries[],
  values: readonly number[],
  total: number,
  options: { stacked: boolean; total: boolean; formatValue: (value: number) => string },
): TooltipContent {
  const all = series.map((item, index) => ({
    key: item.key,
    label: item.label,
    value: options.formatValue(values[index] ?? 0),
    tone: item.tone,
  }));
  if (series.length < 2) return { title: row.label, entries: all, keyed: false };
  const withValue = all.filter((_, index) => (values[index] ?? 0) > 0);
  const entries = options.stacked && (withValue.length > 0 || options.total) ? withValue : all;
  return {
    title: row.label,
    entries,
    keyed: true,
    ...(options.total ? { total: options.formatValue(total) } : {}),
  };
}

/**
 * Bars per row, stacked or grouped, vertical or horizontal: thin bars (at
 * most 24 px) with a rounded data end and a 2 px surface gap between touching
 * segments. Every row is one mark — its whole band the target — whose tooltip
 * and description list the series with their values; the rows are one tab
 * stop, arrow keys move between them, and the table has every number.
 */
export function BarChart({
  title,
  summary,
  series,
  rows,
  layout = "stacked",
  orientation = "vertical",
  formatValue,
  formatTick,
  valueLabels = false,
  tableLabel = "Show the numbers",
  categoryLabel,
  totals,
}: BarChartProps) {
  const { measure, width, rem } = useChartWidth();
  const id = useId();
  const stacked = layout === "stacked" || series.length < 2;
  const showTotal = series.length >= 2 && (totals ?? layout === "stacked");
  const data = useMemo(() => {
    const values = rows.map((row) => seriesValues(row.values, series.length));
    const rowTotals = values.map(sum);
    const max = Math.max(0, ...(stacked ? rowTotals : values.flat()));
    return { values, totals: rowTotals, max };
  }, [rows, series.length, stacked]);
  const model = useMemo(() => {
    if (data.max <= 0 || series.length === 0) return null;
    const input: BarInput = {
      width,
      small: rem * 0.75,
      regular: rem * 0.875,
      rows,
      seriesCount: series.length,
      ...data,
      stacked,
      formatValue,
      formatTick: formatTick ?? formatValue,
      valueLabels,
    };
    return orientation === "horizontal" ? barModel(input) : columnModel(input);
  }, [
    data,
    width,
    rem,
    rows,
    series.length,
    stacked,
    formatValue,
    formatTick,
    valueLabels,
    orientation,
  ]);
  const contents = useMemo(
    () =>
      rows.map((row, index) =>
        rowContent(row, series, data.values[index] ?? [], data.totals[index] ?? 0, {
          stacked: layout === "stacked",
          total: showTotal,
          formatValue,
        }),
      ),
    [rows, series, data, layout, showTotal, formatValue],
  );
  const marks = useChartMarks(model === null ? 0 : rows.length);
  const rowTones = useMemo(
    () =>
      new Map(
        rows.flatMap((row) => (row.tone === undefined ? [] : [[row.key, row.tone] as const])),
      ),
    [rows],
  );

  if (model === null) {
    return (
      <ChartFigure
        title={title}
        summary={summary}
        empty
        className={`bar-chart bar-chart--${orientation}`}
      >
        {null}
      </ChartFigure>
    );
  }
  const shown = marks.shown === null ? undefined : model.marks[marks.shown];
  const shownContent = marks.shown === null ? undefined : contents[marks.shown];
  const focused = marks.focused === null ? undefined : model.marks[marks.focused];
  const columns = [
    { key: "row", label: categoryLabel ?? "" },
    ...series.map((item) => ({ key: `series:${item.key}`, label: item.label, numeric: true })),
    ...(showTotal ? [{ key: "total", label: "Total", numeric: true }] : []),
  ];
  const tableRows = rows.map((row, index) => {
    const rowValues = data.values[index] ?? [];
    return {
      key: row.key,
      cells: [
        row.label,
        ...series.map((_, seriesIndex) => formatValue(rowValues[seriesIndex] ?? 0)),
        ...(showTotal ? [formatValue(data.totals[index] ?? 0)] : []),
      ],
    };
  });
  return (
    <ChartFigure
      title={title}
      summary={summary}
      empty={false}
      className={`bar-chart bar-chart--${orientation}`}
    >
      {series.length >= 2 ? <Legend items={series} shape="bar" label="Legend" /> : null}
      <ChartPlot
        label={title}
        width={width}
        height={model.height}
        measure={measure}
        onPointerLeave={marks.onPointerLeave}
        descriptions={rows.map((row, index) => ({
          id: `${id}d${index}`,
          text: markDescription(contents[index] ?? { title: row.label, entries: [], keyed: false }),
        }))}
        tooltip={
          shown === undefined || shownContent === undefined ? null : (
            <ChartTooltip
              content={shownContent}
              anchor={shown.anchor}
              bounds={{ width, height: model.height }}
              sides={model.sides}
              {...(model.level === undefined ? {} : { level: model.level })}
            />
          )
        }
      >
        {series.length >= 2 ? (
          <defs>
            {series.map((item, index) => (
              <TexturePattern key={item.key} id={`${id}t${index}`} index={index} />
            ))}
          </defs>
        ) : null}
        <svg className="chart__layer" aria-hidden="true">
          {shown === undefined ? null : <rect className="chart__band" {...shown.band} rx={4} />}
          {model.axis === null ? null : (
            <ValueAxis
              orientation={model.axis.orientation}
              ticks={model.axis.ticks}
              plot={model.plot}
              offset={model.axis.offset}
            />
          )}
          {series.map((item, index) => (
            <g
              key={item.key}
              className={toneClass(item.tone)}
              style={textureStyle(index, `${id}t${index}`)}
            >
              {(model.bars[index] ?? []).map((bar) => {
                const own = series.length === 1 ? rowTones.get(bar.key) : undefined;
                return (
                  <path
                    key={bar.key}
                    className={own === undefined ? "chart__mark" : `chart__mark ${toneClass(own)}`}
                    d={bar.path}
                  />
                );
              })}
            </g>
          ))}
          {model.labels.map((label) => (
            <text
              key={label.key}
              className={orientation === "horizontal" ? "chart__label" : "chart__tick"}
              x={label.x}
              y={label.y}
              dy={orientation === "horizontal" ? "0.35em" : "0.71em"}
              textAnchor={label.anchor}
            >
              {label.text}
            </text>
          ))}
          {model.values.map((value) => (
            <text
              key={value.key}
              className={model.smallValues ? "chart__value chart__value--small" : "chart__value"}
              x={value.x}
              y={value.y}
              dy={orientation === "horizontal" ? "0.35em" : undefined}
              textAnchor={value.anchor}
            >
              {value.text}
            </text>
          ))}
        </svg>
        <g>
          {rows.map((row, index) => {
            const mark = model.marks[index];
            return mark === undefined ? null : (
              <MarkTarget
                key={row.key}
                rect={mark.hit}
                label={row.label}
                describedBy={`${id}d${index}`}
                handlers={marks.markProps(index)}
              />
            );
          })}
        </g>
        {focused === undefined ? null : <FocusRing rect={focused.ring} />}
      </ChartPlot>
      <ChartTable label={tableLabel} caption={title} columns={columns} rows={tableRows} />
    </ChartFigure>
  );
}
