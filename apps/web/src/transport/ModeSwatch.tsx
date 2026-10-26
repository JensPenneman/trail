import type { TransportMode } from "@trail/contracts/transport";
import "./ModeSwatch.css";

/** A transport mode's colour; always shown next to the mode's name. */
export function ModeSwatch({ mode, dashed = false }: { mode: TransportMode; dashed?: boolean }) {
  return (
    <span
      className={`mode-swatch mode-color-${mode}${dashed ? " mode-swatch--dashed" : ""}`}
      aria-hidden="true"
    />
  );
}
