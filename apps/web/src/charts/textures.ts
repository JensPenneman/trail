import type { CSSProperties } from "react";

/*
 * Forced colours leave a single ink for every series, so the series of a bar
 * chart are told apart by line textures at 45° and 135° (crossed, sparser,
 * dots) and lines by dash patterns; the legend repeats them. Neither is ever
 * shown otherwise: in colour, texture is noise.
 */

/** The textures in series order; the first series stays solid. */
export const texturePatterns = [
  null,
  { angle: 45, size: 4, kind: "lines" },
  { angle: 135, size: 4, kind: "lines" },
  { angle: 45, size: 5, kind: "cross" },
  { angle: 45, size: 7, kind: "lines" },
  { angle: 135, size: 7, kind: "lines" },
  { angle: 45, size: 8, kind: "cross" },
  { angle: 0, size: 5, kind: "dots" },
] as const;

/** The style that fills the marks of the series at `index` with its texture (pattern `patternId`) in forced colours. */
export function textureStyle(index: number, patternId: string): CSSProperties | undefined {
  return index % texturePatterns.length === 0
    ? undefined
    : ({ "--chart-texture": `url(#${patternId})` } as CSSProperties);
}

/** Dashes for lines 2–4 (a 2 px line with round caps: long dashes, dots, dash-dot). */
const dashes = [null, "7 5", "0.1 5", "9 5 0.1 5"] as const;

/** The style that dashes the line of the series at `index` in forced colours. */
export function dashStyle(index: number): CSSProperties | undefined {
  const dash = dashes[index % dashes.length];
  return dash === null || dash === undefined
    ? undefined
    : ({ "--chart-dash": dash } as CSSProperties);
}
