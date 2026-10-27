import { PlainList } from "../ui/PlainList";
import { heatBounds, heatShade } from "./heatBins";
import "./HeatLegend.css";

interface HeatLegendProps {
  max: number;
  steps: number;
  formatValue: (value: number) => string;
}

/**
 * A heat grid's colour scale from less to more: the empty cell, then every
 * shade with the values it stands for. "Less" and "More" are only a visual
 * cue; the ranges say it in words.
 */
export function HeatLegend({ max, steps, formatValue }: HeatLegendProps) {
  const bounds = heatBounds(max, steps);
  const swatch = (shade: number) => (
    <svg
      className="heat-legend__swatch"
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      <rect className={`heat-grid__cell heat-grid__cell--${shade}`} width="12" height="12" rx="2" />
    </svg>
  );
  return (
    <PlainList className="heat-legend" label="Colour scale">
      <li className="heat-legend__end" aria-hidden="true">
        Less
      </li>
      <li className="heat-legend__item">
        {swatch(0)}
        None
      </li>
      {bounds.map((bound, index) => (
        <li key={bound} className="heat-legend__item">
          {swatch(heatShade(index + 1, steps))}
          {index === 0
            ? `Up to ${formatValue(bound)}`
            : `${formatValue(bounds[index - 1] ?? 0)}–${formatValue(bound)}`}
        </li>
      ))}
      <li className="heat-legend__end" aria-hidden="true">
        More
      </li>
    </PlainList>
  );
}
