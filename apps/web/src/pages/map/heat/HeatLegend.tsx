import { useId } from "react";
import { useFormatter } from "../../../format/useFormatter";
import { heatRamp } from "../../../map/heatRamp";
import { type HeatScale, heatShadeOf } from "../../../map/heatScale";
import { PlainList } from "../../../ui/PlainList";
import "./HeatLegend.css";

interface HeatLegendProps {
  /** The scale the map colours its squares with now. */
  scale: HeatScale;
  /** Whether the map is dark (dark or satellite): the swatches are the colours drawn on it. */
  dark: boolean;
}

/**
 * The key of the heatmap: every colour on the map with the counts it stands
 * for, from the fewest points to the most. "Rarely" and "Often" are only a
 * visual cue; the counts say it in words.
 */
export function HeatLegend({ scale, dark }: HeatLegendProps) {
  const format = useFormatter();
  const titleId = useId();
  const ramp = dark ? heatRamp.dark : heatRamp.light;
  const classes = scale.starts.length;
  if (classes === 0) return null;
  return (
    <div className="map-heat-legend">
      <p className="map-heat-legend__title" id={titleId}>
        Points recorded in each square
      </p>
      <PlainList className="map-heat-legend__scale" labelledBy={titleId}>
        <li className="map-heat-legend__end" aria-hidden="true">
          Rarely
        </li>
        {scale.starts.map((start, index) => {
          const next = scale.starts[index + 1];
          const label =
            next === undefined
              ? `${format.count(start)} or more`
              : next - 1 === start
                ? format.count(start)
                : `${format.count(start)}–${format.count(next - 1)}`;
          return (
            <li key={start} className="map-heat-legend__item">
              <span
                className="map-heat-legend__swatch"
                style={{ backgroundColor: ramp[heatShadeOf(index, classes) - 1] }}
                aria-hidden="true"
              />
              {label}
            </li>
          );
        })}
        <li className="map-heat-legend__end" aria-hidden="true">
          Often
        </li>
      </PlainList>
    </div>
  );
}
