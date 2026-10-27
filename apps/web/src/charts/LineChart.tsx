import { useId, useMemo } from "react";
import { categoryAxis } from "./bands";
import { ChartFigure } from "./ChartFigure";
import { ChartPlot } from "./ChartPlot";
import { ChartTable } from "./ChartTable";
import { ChartTooltip } from "./ChartTooltip";
import type { ChartRow, ChartSeries, PlotText, Rect, TooltipContent } from "./chartTypes";
import { seriesValues } from "./chartValues";
import { FocusRing } from "./FocusRing";
import { Legend } from "./Legend";
import { MarkTarget } from "./MarkTarget";
import { markDescription } from "./markDescription";
import { linearScale } from "./scales";
import { dashStyle } from "./textures";
import { textWidth } from "./textWidth";
import { niceTicks } from "./ticks";
import { toneClass } from "./tones";
import { useChartMarks } from "./useChartMarks";
import { useChartWidth } from "./useChartWidth";
import { type AxisTick, ValueAxis } from "./ValueAxis";
import "./LineChart.css";

interface LineChartProps {
  title: string;
  /** The one-line summary in words under the title: the figure's description. */
  summary: string;
  /** At most four lines, on one shared axis; more cannot be told apart. */
  series: readonly ChartSeries[];
  rows: readonly ChartRow[];
  formatValue: (value: number) => string;
  /** The value axis' labels, e.g. a compact "10 km"; `formatValue` by default. */
  formatTick?: (value: number) => string;
  /** A 10 % wash of the line's colour under it; for a single series only. */
  area?: boolean;
  /** The summary of the table's disclosure; "Show the numbers" by default. */
  tableLabel?: string;
  /** The table's header over the row names ("Day"); the corner stays empty without one. */
  categoryLabel?: string;
}

/** The chart's height, the x axis' labels included. */
const lineChartHeight = 240;
/** Up to a month of points shows a dot on each; denser lines only on the last. */
const dottedRows = 31;

const r2 = (value: number): number => Math.round(value * 100) / 100;

interface LineModel {
  plot: Rect;
  ticks: AxisTick[];
  offset: number;
  /** Each row's x position. */
  xs: number[];
  /** Each row's y per series. */
  ys: number[][];
  paths: string[];
  area: string | null;
  /** Rows that show their dots. */
  dotted: number[];
  labels: PlotText[];
  /** Each row's hit target, and its focus ring around the crosshair and its dots. */
  columns: { hit: Rect; ring: Rect }[];
}

function lineModel(input: {
  width: number;
  small: number;
  rows: readonly ChartRow[];
  seriesCount: number;
  values: readonly (readonly number[])[];
  max: number;
  formatTick: (value: number) => string;
  area: boolean;
}): LineModel {
  const { width, small, rows, values } = input;
  const top = Math.ceil(small);
  const bottom = Math.ceil(small * 2.5);
  const plotHeight = lineChartHeight - top - bottom;
  const tickValues = niceTicks(input.max, Math.min(6, Math.max(2, Math.round(plotHeight / 48))));
  const tickLabels = tickValues.map((value) => input.formatTick(value));
  const offset = Math.round(small * 0.66);
  const yAxis =
    Math.ceil(Math.max(0, ...tickLabels.map((label) => textWidth(label, small)))) + offset + 2;
  const names = rows.map((row) => row.tick ?? row.label);
  const across = categoryAxis({
    width,
    left: yAxis,
    right: 6,
    labelWidths: names.map((name) => textWidth(name, small)),
  });
  const plot = { x: across.left, y: top, width: across.step * rows.length, height: plotHeight };
  const base = top + plotHeight;
  const y = linearScale([0, tickValues.at(-1) ?? 1], [base, top]);
  const xs = rows.map((_, index) => plot.x + across.step * (index + 0.5));
  const ys = values.map((row) => row.map((value) => y(value)));
  const paths = Array.from({ length: input.seriesCount }, (_, series) =>
    xs
      .map((x, index) => `${index === 0 ? "M" : "L"}${r2(x)} ${r2(ys[index]?.[series] ?? base)}`)
      .join(""),
  );
  const first = xs[0] ?? plot.x;
  const last = xs.at(-1) ?? plot.x;
  const area =
    input.area && input.seriesCount === 1
      ? `M${r2(first)} ${base}${xs.map((x, index) => `L${r2(x)} ${r2(ys[index]?.[0] ?? base)}`).join("")}L${r2(last)} ${base}Z`
      : null;
  const dotted =
    rows.length <= dottedRows && across.step >= 10
      ? rows.map((_, index) => index)
      : [rows.length - 1];
  return {
    plot,
    ticks: tickValues.map((value, index) => ({
      value,
      position: y(value),
      label: tickLabels[index] ?? "",
    })),
    offset,
    xs,
    ys,
    paths,
    area,
    dotted,
    labels: rows.flatMap((row, index) =>
      index % across.stride === 0
        ? [
            {
              key: row.key,
              x: xs[index] ?? plot.x,
              y: base + Math.round(small * 0.66),
              text: names[index] ?? "",
              anchor: "middle" as const,
            },
          ]
        : [],
    ),
    columns: rows.map((_, index) => {
      const x = plot.x + index * across.step;
      const centre = x + across.step / 2;
      return {
        hit: { x, y: 0, width: across.step, height: lineChartHeight },
        ring: { x: centre - 10, y: top - 4, width: 20, height: plotHeight + 8 },
      };
    }),
  };
}

/**
 * Up to four series over the same rows on one value axis: 2 px lines with
 * round joins, a dot on every point while there are few, and always on the
 * last. The x positions are the marks: the crosshair snaps to the nearest
 * and one tooltip lists every series there; they are one tab stop that the
 * arrow keys move along.
 */
export function LineChart({
  title,
  summary,
  series,
  rows,
  formatValue,
  formatTick,
  area = false,
  tableLabel = "Show the numbers",
  categoryLabel,
}: LineChartProps) {
  const { measure, width, rem } = useChartWidth();
  const id = useId();
  const values = useMemo(
    () => rows.map((row) => seriesValues(row.values, series.length)),
    [rows, series.length],
  );
  const max = Math.max(0, ...values.flat());
  const model = useMemo(
    () =>
      max > 0 && series.length > 0
        ? lineModel({
            width,
            small: rem * 0.75,
            rows,
            seriesCount: series.length,
            values,
            max,
            formatTick: formatTick ?? formatValue,
            area,
          })
        : null,
    [width, rem, rows, series.length, values, max, formatTick, formatValue, area],
  );
  const contents = useMemo(
    () =>
      rows.map(
        (row, index): TooltipContent => ({
          title: row.label,
          keyed: series.length >= 2,
          entries: series.map((item, seriesIndex) => ({
            key: item.key,
            label: item.label,
            value: formatValue(values[index]?.[seriesIndex] ?? 0),
            tone: item.tone,
          })),
        }),
      ),
    [rows, series, values, formatValue],
  );
  const marks = useChartMarks(model === null ? 0 : rows.length);

  if (model === null) {
    return (
      <ChartFigure title={title} summary={summary} empty className="line-chart">
        {null}
      </ChartFigure>
    );
  }
  const shown = marks.shown;
  const shownContent = shown === null ? undefined : contents[shown];
  const shownX = shown === null ? undefined : model.xs[shown];
  const focused = marks.focused === null ? undefined : model.columns[marks.focused];
  const base = model.plot.y + model.plot.height;
  const shownTop = shown === null ? base : Math.min(base, ...(model.ys[shown] ?? []));
  return (
    <ChartFigure title={title} summary={summary} empty={false} className="line-chart">
      {series.length >= 2 ? <Legend items={series} shape="line" label="Legend" /> : null}
      <ChartPlot
        label={title}
        width={width}
        height={lineChartHeight}
        measure={measure}
        onPointerLeave={marks.onPointerLeave}
        descriptions={rows.map((row, index) => ({
          id: `${id}d${index}`,
          text: markDescription(contents[index] ?? { title: row.label, entries: [], keyed: false }),
        }))}
        tooltip={
          shownContent === undefined || shownX === undefined ? null : (
            <ChartTooltip
              content={shownContent}
              anchor={{ x: shownX - 6, y: shownTop - 6, width: 12, height: base - shownTop + 6 }}
              bounds={{ width, height: lineChartHeight }}
              sides={["right", "left", "top"]}
              level={model.plot.y}
            />
          )
        }
      >
        <svg className="chart__layer" aria-hidden="true">
          <ValueAxis
            orientation="vertical"
            ticks={model.ticks}
            plot={model.plot}
            offset={model.offset}
          />
          {shownX === undefined ? null : (
            <line
              className="line-chart__crosshair"
              x1={Math.round(shownX) + 0.5}
              x2={Math.round(shownX) + 0.5}
              y1={model.plot.y}
              y2={base}
            />
          )}
          {series.map((item, seriesIndex) => (
            <g key={item.key} className={toneClass(item.tone)} style={dashStyle(seriesIndex)}>
              {seriesIndex === 0 && model.area !== null ? (
                <path className="line-chart__area" d={model.area} />
              ) : null}
              <path className="line-chart__line" d={model.paths[seriesIndex] ?? ""} />
              {model.dotted.map((index) => (
                <circle
                  key={rows[index]?.key ?? "last"}
                  className="line-chart__marker"
                  cx={model.xs[index] ?? 0}
                  cy={model.ys[index]?.[seriesIndex] ?? base}
                  r={5}
                />
              ))}
            </g>
          ))}
          {shown === null || shownX === undefined
            ? null
            : series.map((item, seriesIndex) => (
                <circle
                  key={item.key}
                  className={`line-chart__marker ${toneClass(item.tone)}`}
                  cx={shownX}
                  cy={model.ys[shown]?.[seriesIndex] ?? base}
                  r={6}
                />
              ))}
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
          {rows.map((row, index) => {
            const column = model.columns[index];
            return column === undefined ? null : (
              <MarkTarget
                key={row.key}
                rect={column.hit}
                label={row.label}
                describedBy={`${id}d${index}`}
                handlers={marks.markProps(index)}
              />
            );
          })}
        </g>
        {focused === undefined ? null : <FocusRing rect={focused.ring} />}
      </ChartPlot>
      <ChartTable
        label={tableLabel}
        caption={title}
        columns={[
          { key: "row", label: categoryLabel ?? "" },
          ...series.map((item) => ({
            key: `series:${item.key}`,
            label: item.label,
            numeric: true,
          })),
        ]}
        rows={rows.map((row, index) => ({
          key: row.key,
          cells: [
            row.label,
            ...series.map((_, seriesIndex) => formatValue(values[index]?.[seriesIndex] ?? 0)),
          ],
        }))}
      />
    </ChartFigure>
  );
}
