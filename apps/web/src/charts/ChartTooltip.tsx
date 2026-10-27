import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { Rect, TooltipContent } from "./chartTypes";
import { toneClass } from "./tones";
import { placeTooltip, type TooltipSide } from "./tooltipPlacement";
import "./ChartTooltip.css";

interface ChartTooltipProps {
  content: TooltipContent;
  /** The mark it belongs to, in the plot's pixels. */
  anchor: Rect;
  /** The plot box it stays inside. */
  bounds: { width: number; height: number };
  /** Where to try to put it, in order. */
  sides: readonly TooltipSide[];
  /** Beside the mark, the tooltip's top: the plot's top for columns and lines, so it never covers the axis. */
  level?: number;
}

/**
 * The chart's one tooltip: the values lead, strong, each keyed by a short
 * line of its series' colour and followed by the series' name. Hidden from
 * screen readers, which read the same text as the mark's description.
 */
export function ChartTooltip({ content, anchor, bounds, sides, level }: ChartTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Measured before paint, so the tooltip appears where it fits and never jumps.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    setSize((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  });
  const { left, top } = placeTooltip(
    anchor,
    size,
    bounds,
    sides,
    level === undefined ? {} : { level },
  );
  return (
    <div ref={ref} className="chart-tooltip" aria-hidden="true" style={{ left, top }}>
      <p className="chart-tooltip__title">{content.title}</p>
      <div
        className={
          content.keyed ? "chart-tooltip__rows" : "chart-tooltip__rows chart-tooltip__rows--plain"
        }
      >
        {content.entries.map((entry) =>
          content.keyed ? (
            <Fragment key={entry.key}>
              <span className={`chart-tooltip__key ${toneClass(entry.tone)}`} />
              <strong className="chart-tooltip__value">{entry.value}</strong>
              <span className="chart-tooltip__label">{entry.label}</span>
            </Fragment>
          ) : (
            <strong key={entry.key} className="chart-tooltip__value">
              {entry.value}
            </strong>
          ),
        )}
        {content.total === undefined ? null : (
          <>
            <span className="chart-tooltip__rule" />
            {content.keyed ? <span /> : null}
            <strong className="chart-tooltip__value">{content.total}</strong>
            {content.keyed ? <span className="chart-tooltip__label">Total</span> : null}
          </>
        )}
      </div>
    </div>
  );
}
