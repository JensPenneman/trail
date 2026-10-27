import type { PointerEvent, ReactNode } from "react";
import "./ChartPlot.css";

interface ChartPlotProps {
  /** The chart's title: the name of the group of marks. */
  label: string;
  width: number;
  height: number;
  measure: (element: HTMLElement | null) => (() => void) | undefined;
  onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  /** What each mark's `aria-describedby` points at: its values in words. */
  descriptions: readonly { id: string; text: string }[];
  /** The one tooltip, over the plot. */
  tooltip: ReactNode;
  /** The SVG's content. */
  children: ReactNode;
}

/**
 * The plot: an SVG drawn at the box's real width (the viewBox is in CSS
 * pixels, so text stays crisp), its marks a labelled group, plus the
 * tooltip and the marks' descriptions. Not an image as a whole: its marks are
 * focusable, which a role with presentational children would hide.
 */
export function ChartPlot({
  label,
  width,
  height,
  measure,
  onPointerLeave,
  descriptions,
  tooltip,
  children,
}: ChartPlotProps) {
  return (
    <>
      <div className="chart__plot" ref={measure} onPointerLeave={onPointerLeave}>
        {/* biome-ignore lint/a11y/useSemanticElements: a group of SVG marks; a fieldset cannot be drawn inside an SVG */}
        <svg
          className="chart__svg"
          role="group"
          aria-label={label}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
        >
          {children}
        </svg>
        {tooltip}
      </div>
      <div hidden>
        {descriptions.map((description) => (
          <p key={description.id} id={description.id}>
            {description.text}
          </p>
        ))}
      </div>
    </>
  );
}
