import { type ReactNode, useId } from "react";
import { nothingToShow } from "./summaries";
import "./ChartFigure.css";

interface ChartFigureProps {
  title: string;
  summary: string;
  /** Nothing to draw: the figure keeps its title and summary and says so in place of the plot. */
  empty: boolean;
  className: string;
  children: ReactNode;
}

/**
 * The frame every chart shares: a figure named by its visible title and
 * described by its one-line summary, around the legend, the plot and the
 * table of numbers.
 */
export function ChartFigure({ title, summary, empty, className, children }: ChartFigureProps) {
  const titleId = useId();
  const summaryId = useId();
  return (
    <figure className={`chart ${className}`} aria-labelledby={titleId} aria-describedby={summaryId}>
      <figcaption className="chart__caption">
        <p className="chart__title" id={titleId}>
          {title}
        </p>
        <p className="chart__summary" id={summaryId}>
          {summary}
        </p>
      </figcaption>
      {empty ? (
        // A summary that already says so (describeBars of nothing) needs no second line.
        summary === nothingToShow ? null : (
          <p className="chart__empty">{nothingToShow}</p>
        )
      ) : (
        children
      )}
    </figure>
  );
}
