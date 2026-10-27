import type { Rect } from "./chartTypes";
import type { MarkHandlers } from "./useChartMarks";

interface MarkTargetProps {
  /** The hit area: the whole band or cell, bigger than what is painted. */
  rect: Rect;
  /** The row's or cell's name. */
  label: string;
  /** The id of the element holding its values in words. */
  describedBy: string;
  handlers: MarkHandlers;
}

/**
 * One mark as assistive technology and the keyboard meet it: an image named
 * by its row and described by its values, transparent over the drawing. A
 * nested SVG rather than a rect, so that it is an element with a role of its
 * own that can take focus.
 */
export function MarkTarget({ rect, label, describedBy, handlers }: MarkTargetProps) {
  return (
    <svg
      className="chart__target"
      x={rect.x}
      y={rect.y}
      width={Math.max(0, rect.width)}
      height={Math.max(0, rect.height)}
      role="img"
      aria-label={label}
      aria-describedby={describedBy}
      {...handlers}
    >
      <rect className="chart__hit" width="100%" height="100%" />
    </svg>
  );
}
