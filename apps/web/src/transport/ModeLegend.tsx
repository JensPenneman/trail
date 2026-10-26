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
}

/** What the colours on the map mean: the modes shown, and the dashed outline. */
export function ModeLegend({ modes, review }: ModeLegendProps) {
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
      </PlainList>
    </section>
  );
}
