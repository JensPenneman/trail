import { useId, useMemo } from "react";
import { surfaceGap } from "./bands";
import { ChartFigure } from "./ChartFigure";
import { ChartPlot } from "./ChartPlot";
import { ChartTable } from "./ChartTable";
import { ChartTooltip } from "./ChartTooltip";
import type { PlotText, Rect } from "./chartTypes";
import { chartValue } from "./chartValues";
import { FocusRing } from "./FocusRing";
import { HeatLegend } from "./HeatLegend";
import { heatBin, heatShade, heatSteps, legibleHeatSteps } from "./heatBins";
import { MarkTarget } from "./MarkTarget";
import { textWidth } from "./textWidth";
import { tickStride } from "./ticks";
import { useChartMarks } from "./useChartMarks";
import { useChartWidth } from "./useChartWidth";
import "./HeatGrid.css";

interface HeatAxisItem {
  key: string;
  /** Full name, for the table: "Monday". */
  label: string;
  /** Axis label: "Mon". */
  tick: string;
}

interface HeatGridProps {
  title: string;
  /** The one-line summary in words under the title: the figure's description. */
  summary: string;
  rows: readonly HeatAxisItem[];
  columns: readonly HeatAxisItem[];
  /** `values[row][column]`. */
  values: readonly (readonly number[])[];
  /** A cell's full name, for its tooltip and accessible name: "Monday, 08:00–09:00". */
  cellLabel: (row: HeatAxisItem, column: HeatAxisItem) => string;
  formatValue: (value: number) => string;
  /** How many shades: equal bins of (0, largest value], 1 to 5; 5 by default. */
  steps?: number;
  /** The summary of the table's disclosure; "Show the numbers" by default. */
  tableLabel?: string;
  /** The table's header over the row names ("Day"); the corner stays empty without one. */
  categoryLabel?: string;
}

/** Cells stop growing here; a wide screen leaves the rest of the row empty. */
const largestCell = 36;

interface HeatCell {
  key: string;
  /** The cell drawn, and its focus ring's box. */
  rect: Rect;
  /** The whole slot, the surface gap included: the hit target. */
  hit: Rect;
  shade: number;
}

function heatModel(input: {
  width: number;
  small: number;
  rows: readonly HeatAxisItem[];
  columns: readonly HeatAxisItem[];
  values: readonly (readonly number[])[];
  max: number;
  steps: number;
}) {
  const { width, small, rows, columns, values, max, steps } = input;
  const left = Math.ceil(Math.max(0, ...rows.map((row) => textWidth(row.tick, small)))) + 8;
  const top = Math.ceil(small * 1.7);
  // Cells shrink with the width (24 columns on a 320 px phone: about 11 px each), never past it.
  const step = Math.min(largestCell, Math.max(0, width - left - 4) / Math.max(1, columns.length));
  // Rows stay a line of text tall, so every row keeps its label and a finger finds it.
  const rowStep = Math.max(step, small + 2);
  const columnStride = tickStride(
    step,
    Math.max(0, ...columns.map((column) => textWidth(column.tick, small))),
    6,
  );
  const rowStride = tickStride(rowStep, small, 2);
  const cells: HeatCell[] = [];
  for (const [r, row] of rows.entries()) {
    for (const [c, column] of columns.entries()) {
      const x = left + c * step;
      const y = top + r * rowStep;
      cells.push({
        key: `${row.key}:${column.key}`,
        rect: {
          x: x + surfaceGap / 2,
          y: y + surfaceGap / 2,
          width: Math.max(1, step - surfaceGap),
          height: Math.max(1, rowStep - surfaceGap),
        },
        hit: { x, y, width: step, height: rowStep },
        shade: heatShade(heatBin(chartValue(values[r]?.[c]), max, steps), steps),
      });
    }
  }
  const labels: PlotText[] = [
    ...columns.flatMap((column, c) =>
      c % columnStride === 0
        ? [
            {
              key: `column:${column.key}`,
              x: left + c * step + step / 2,
              y: top - Math.round(small * 0.5),
              text: column.tick,
              anchor: "middle" as const,
            },
          ]
        : [],
    ),
    ...rows.flatMap((row, r) =>
      r % rowStride === 0
        ? [
            {
              key: `row:${row.key}`,
              x: left - 6,
              y: top + r * rowStep + rowStep / 2,
              text: row.tick,
              anchor: "end" as const,
            },
          ]
        : [],
    ),
  ];
  return { height: top + rows.length * rowStep + 4, cells, labels };
}

/**
 * A rows × columns grid of cells (weekdays × hours) shaded by value in a
 * neutral ramp: equal bins of the largest value, an empty cell for nothing,
 * a scale legend under it. Every cell is a mark; the grid is one tab stop,
 * Left/Right move along a row, Up/Down between rows, Home/End to the row's
 * ends (with Ctrl, the grid's).
 */
export function HeatGrid({
  title,
  summary,
  rows,
  columns,
  values,
  cellLabel,
  formatValue,
  steps,
  tableLabel = "Show the numbers",
  categoryLabel,
}: HeatGridProps) {
  const { measure, width, rem } = useChartWidth();
  const id = useId();
  const max = useMemo(
    () =>
      Math.max(0, ...rows.flatMap((_, r) => columns.map((__, c) => chartValue(values[r]?.[c])))),
    [rows, columns, values],
  );
  const shades = useMemo(
    () => legibleHeatSteps(max, heatSteps(steps), formatValue),
    [max, steps, formatValue],
  );
  const model = useMemo(
    () =>
      max > 0 && columns.length > 0
        ? heatModel({ width, small: rem * 0.75, rows, columns, values, max, steps: shades })
        : null,
    [max, width, rem, rows, columns, values, shades],
  );
  const cellText = useMemo(
    () =>
      rows.flatMap((row, r) =>
        columns.map((column, c) => ({
          label: cellLabel(row, column),
          value: formatValue(chartValue(values[r]?.[c])),
        })),
      ),
    [rows, columns, values, cellLabel, formatValue],
  );
  const marks = useChartMarks(model === null ? 0 : rows.length * columns.length, columns.length);

  if (model === null) {
    return (
      <ChartFigure title={title} summary={summary} empty className="heat-grid">
        {null}
      </ChartFigure>
    );
  }
  const shown = marks.shown === null ? undefined : model.cells[marks.shown];
  const shownText = marks.shown === null ? undefined : cellText[marks.shown];
  const focused = marks.focused === null ? undefined : model.cells[marks.focused];
  return (
    <ChartFigure title={title} summary={summary} empty={false} className="heat-grid">
      <ChartPlot
        label={title}
        width={width}
        height={model.height}
        measure={measure}
        onPointerLeave={marks.onPointerLeave}
        descriptions={cellText.map((text, index) => ({ id: `${id}d${index}`, text: text.value }))}
        tooltip={
          shown === undefined || shownText === undefined ? null : (
            <ChartTooltip
              content={{
                title: shownText.label,
                keyed: false,
                entries: [{ key: "value", label: "", value: shownText.value, tone: "muted" }],
              }}
              anchor={shown.rect}
              bounds={{ width, height: model.height }}
              sides={["top", "bottom", "right", "left"]}
            />
          )
        }
      >
        <svg className="chart__layer" aria-hidden="true">
          {model.cells.map((cell) => (
            <rect
              key={cell.key}
              className={`heat-grid__cell heat-grid__cell--${cell.shade}`}
              {...cell.rect}
              rx={2}
            />
          ))}
          {model.labels.map((label) => (
            <text
              key={label.key}
              className="chart__tick"
              x={label.x}
              y={label.y}
              dy="0.32em"
              textAnchor={label.anchor}
            >
              {label.text}
            </text>
          ))}
        </svg>
        <g>
          {model.cells.map((cell, index) => (
            <MarkTarget
              key={cell.key}
              rect={cell.hit}
              label={cellText[index]?.label ?? ""}
              describedBy={`${id}d${index}`}
              handlers={marks.markProps(index)}
            />
          ))}
        </g>
        {shown === undefined ? null : (
          <svg className="chart__layer" aria-hidden="true">
            <rect
              className="heat-grid__hover"
              x={shown.rect.x - 1}
              y={shown.rect.y - 1}
              width={shown.rect.width + 2}
              height={shown.rect.height + 2}
              rx={3}
            />
          </svg>
        )}
        {focused === undefined ? null : <FocusRing rect={focused.rect} spread={3} />}
      </ChartPlot>
      <HeatLegend max={max} steps={shades} formatValue={formatValue} />
      <ChartTable
        label={tableLabel}
        caption={title}
        columns={[
          { key: "row", label: categoryLabel ?? "" },
          ...columns.map((column) => ({
            key: `column:${column.key}`,
            label: column.label,
            numeric: true,
          })),
        ]}
        rows={rows.map((row, r) => ({
          key: row.key,
          cells: [
            row.label,
            ...columns.map((_, c) => cellText[r * columns.length + c]?.value ?? ""),
          ],
        }))}
      />
    </ChartFigure>
  );
}
