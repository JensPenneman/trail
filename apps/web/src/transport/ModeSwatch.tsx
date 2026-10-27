import type { TransportMode } from "@trail/contracts/transport";
import "./ModeSwatch.css";

/**
 * A transport mode's colour, as a line is drawn on the map: solid, dashed
 * (to review), dotted (the path within a stop) or thin and dashed (a gap in
 * the recording). Always shown next to the mode's name.
 */
export function ModeSwatch({
  mode,
  dashed = false,
  dotted = false,
  gap = false,
}: {
  mode: TransportMode;
  dashed?: boolean;
  dotted?: boolean;
  gap?: boolean;
}) {
  const variant = gap
    ? " mode-swatch--gap"
    : dotted
      ? " mode-swatch--dotted"
      : dashed
        ? " mode-swatch--dashed"
        : "";
  return <span className={`mode-swatch mode-color-${mode}${variant}`} aria-hidden="true" />;
}
