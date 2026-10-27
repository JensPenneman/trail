import type { Rect } from "./chartTypes";
import "./FocusRing.css";

/**
 * The keyboard focus ring of a mark, drawn last so it sits above the plot
 * (SVG paints in order: inside the mark's own element its neighbours would
 * cover it). `spread` grows the box around a mark that has no room of its own.
 */
export function FocusRing({ rect, spread = 0 }: { rect: Rect; spread?: number }) {
  const box = {
    x: rect.x - spread,
    y: rect.y - spread,
    width: Math.max(0, rect.width + 2 * spread),
    height: Math.max(0, rect.height + 2 * spread),
  };
  return (
    <svg className="chart__layer chart__focus" aria-hidden="true">
      <rect className="chart__focus-halo" {...box} rx={4} />
      <rect className="chart__focus-ring" {...box} rx={4} />
    </svg>
  );
}
