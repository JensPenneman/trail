import type { ChartTone } from "./chartTypes";
import "./tones.css";

/**
 * The class that gives an element its tone as `--mode-color`: a mode's own
 * swatch class from tokens.css, or the accent or muted class, so every mark,
 * legend key and tooltip key reads the one variable.
 */
export function toneClass(tone: ChartTone): string {
  return tone === "accent" || tone === "muted" ? `chart-tone-${tone}` : `mode-color-${tone}`;
}
