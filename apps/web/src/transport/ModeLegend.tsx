import { type TransportMode, transportModes } from "@trail/contracts/transport";
import { useId } from "react";
import { PlainList } from "../ui/PlainList";
import { ModeSwatch } from "./ModeSwatch";
import { transportModeInfo } from "./transportModes";
import "./ModeLegend.css";

interface ModeLegendProps {
  /** The modes on the map. */
  modes: ReadonlySet<TransportMode>;
  /** Whether a move to review is on the map. */
  review: boolean;
  /** Whether a stop is drawn with the path within it. */
  stopPaths?: boolean;
  /** Whether a recording gap is bridged on the map. */
  gaps?: boolean;
}

/**
 * What the lines on the map mean: the modes shown, the dashed outline, the
 * dotted path within a stop and the connector across a gap in the recording.
 */
export function ModeLegend({ modes, review, stopPaths = false, gaps = false }: ModeLegendProps) {
  const headingId = useId();
  if (modes.size === 0) return null;
  return (
    <section className="mode-legend" aria-labelledby={headingId}>
      <h2 className="visually-hidden" id={headingId}>
        Map legend
      </h2>
      <PlainList className="mode-legend__list">
        {transportModes
          .filter((mode) => modes.has(mode))
          .map((mode) => (
            <li key={mode} className="mode-legend__item">
              <ModeSwatch mode={mode} />
              {transportModeInfo[mode].label}
            </li>
          ))}
        {review ? (
          <li className="mode-legend__item">
            <ModeSwatch mode="unknown" dashed />
            Unsure: worth a look
          </li>
        ) : null}
        {stopPaths ? (
          <li className="mode-legend__item">
            <ModeSwatch mode="stationary" dotted />
            Moved within a stop
          </li>
        ) : null}
        {gaps ? (
          <li className="mode-legend__item">
            <ModeSwatch mode="unknown" gap />
            No data: a gap in the recording
          </li>
        ) : null}
      </PlainList>
    </section>
  );
}
