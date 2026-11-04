import type { TransportMode } from "@trail/contracts/transport";
import { useFormatter } from "../../../format/useFormatter";
import { transportModeInfo } from "../../../transport/transportModes";
import { Icon } from "../../../ui/Icon";
import type { HeatPeriod } from "./heatPeriod";
import { periodLabel } from "./lensLabel";
import "./HeatLens.css";

interface HeatLensProps {
  /** The period filtering the answer on screen; null where only a mode does. */
  period: HeatPeriod | null;
  /** The mode filtering it (time on the move, speed, top speed). */
  mode: TransportMode | null;
  /** Takes the lens off: the measure and the period go from the address, in place of its entry. */
  onClear: () => void;
}

/**
 * The chip over Heat's controls that says the answer is filtered ("October 2026"), the way an
 * Insights page sends one here. Its ✕ shows all time again; Back returns to where it came from.
 */
export function HeatLens({ period, mode, onClear }: HeatLensProps) {
  const format = useFormatter();
  return (
    <p className="heat-lens">
      <span className="heat-lens__label">
        {[
          period === null ? null : periodLabel(period, format),
          mode === null ? null : transportModeInfo[mode].label,
        ]
          .filter((part) => part !== null)
          .join(" · ")}
      </span>
      <button type="button" className="heat-lens__clear" onClick={onClear}>
        <Icon name="close" />
        <span className="visually-hidden">
          {mode === null ? "Show all time" : "Show all time and every mode"}
        </span>
      </button>
    </p>
  );
}
