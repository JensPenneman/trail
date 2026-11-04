import { useFormatter } from "../../../format/useFormatter";
import { Icon } from "../../../ui/Icon";
import type { HeatPeriod } from "./heatPeriod";
import { periodLabel } from "./lensLabel";
import "./HeatLens.css";

interface HeatLensProps {
  /** The period filtering the answer on screen. */
  period: HeatPeriod;
  /** Takes the lens off: the measure and the period go from the address, in place of its entry. */
  onClear: () => void;
}

/**
 * The chip over Heat's controls that says the answer is filtered ("October 2026"), the way an
 * Insights page sends one here. Its ✕ shows all time again; Back returns to where it came from.
 */
export function HeatLens({ period, onClear }: HeatLensProps) {
  const format = useFormatter();
  return (
    <p className="heat-lens">
      <span className="heat-lens__label">{periodLabel(period, format)}</span>
      <button type="button" className="heat-lens__clear" onClick={onClear}>
        <Icon name="close" />
        <span className="visually-hidden">Show all time</span>
      </button>
    </p>
  );
}
