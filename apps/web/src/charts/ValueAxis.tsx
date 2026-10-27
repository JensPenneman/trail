import type { Rect } from "./chartTypes";
import "./ValueAxis.css";

export interface AxisTick {
  value: number;
  /** Where the value falls along the axis, in px. */
  position: number;
  label: string;
}

interface ValueAxisProps {
  /** `vertical`: values up a y axis left of the plot; `horizontal`: along an x axis under it. */
  orientation: "vertical" | "horizontal";
  ticks: readonly AxisTick[];
  plot: Rect;
  /** The gap between the plot and the labels. */
  offset: number;
}

/** Odd coordinates centre a 1 px line on a pixel, so a hairline stays one crisp pixel. */
const crisp = (position: number): number => Math.round(position) + 0.5;

/**
 * Hairline gridlines at the round values and their labels, with the zero line
 * as the stronger baseline. Decorative: the marks' descriptions and the table
 * carry every value.
 */
export function ValueAxis({ orientation, ticks, plot, offset }: ValueAxisProps) {
  const bottom = plot.y + plot.height;
  if (orientation === "vertical") {
    const baseline = Math.round(bottom) + 0.5;
    return (
      <g>
        {ticks.map((tick) => (
          <g key={tick.value}>
            {tick.value === 0 ? null : (
              <line
                className="chart__grid"
                x1={plot.x}
                x2={plot.x + plot.width}
                y1={crisp(tick.position)}
                y2={crisp(tick.position)}
              />
            )}
            <text
              className="chart__tick"
              x={plot.x - offset}
              y={tick.position}
              dy="0.32em"
              textAnchor="end"
            >
              {tick.label}
            </text>
          </g>
        ))}
        <line
          className="chart__baseline"
          x1={plot.x}
          x2={plot.x + plot.width}
          y1={baseline}
          y2={baseline}
        />
      </g>
    );
  }
  // The bars start on the pixel right of the zero line.
  const baseline = Math.round(plot.x) - 0.5;
  return (
    <g>
      {ticks.map((tick) => (
        <g key={tick.value}>
          {tick.value === 0 ? null : (
            <line
              className="chart__grid"
              x1={crisp(tick.position)}
              x2={crisp(tick.position)}
              y1={plot.y}
              y2={bottom}
            />
          )}
          <text
            className="chart__tick"
            x={tick.position}
            y={bottom + offset}
            dy="0.71em"
            textAnchor="middle"
          >
            {tick.label}
          </text>
        </g>
      ))}
      <line className="chart__baseline" x1={baseline} x2={baseline} y1={plot.y} y2={bottom} />
    </g>
  );
}
