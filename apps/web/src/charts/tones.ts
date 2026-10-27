import type { ChartTone } from "./chartTypes";
import "./tones.css";

const ownTones: ReadonlySet<ChartTone> = new Set([
  "accent",
  "muted",
  "category-1",
  "category-2",
  "category-3",
]);

/**
 * The class that gives an element its tone as `--mode-color`: a mode's own
 * swatch class from tokens.css, or the class of the accent, muted or a
 * categorical slot, so every mark, legend key and tooltip key reads the one
 * variable.
 */
export function toneClass(tone: ChartTone): string {
  return ownTones.has(tone) ? `chart-tone-${tone}` : `mode-color-${tone}`;
}
