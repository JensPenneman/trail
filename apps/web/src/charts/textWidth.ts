/*
 * Charts lay out their text before anything is painted (and in tests,
 * nothing ever is), so label widths are estimated from typical advance widths
 * of the system sans, in em, rounded up: a margin a little too wide is
 * harmless, one too narrow clips a label.
 */
const narrow = new Set([..."iIjl.,:;'|!·"]);
const semiNarrow = new Set([..."frt()[]-/"]);
const wide = new Set([..."mwMW%@…"]);

function advance(char: string): number {
  if (char === " " || narrow.has(char)) return 0.3;
  if (semiNarrow.has(char)) return 0.42;
  if (wide.has(char)) return 0.9;
  if (char >= "0" && char <= "9") return 0.62;
  if (char >= "A" && char <= "Z") return 0.7;
  return 0.6;
}

/** About how wide `text` renders at `fontSize` px. */
export function textWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const char of text) em += advance(char);
  return em * fontSize;
}

/** `text`, cut short with an ellipsis where it would grow wider than `maxWidth`. */
export function fitText(text: string, maxWidth: number, fontSize: number): string {
  if (textWidth(text, fontSize) <= maxWidth) return text;
  const chars = [...text];
  for (let end = chars.length - 1; end > 0; end -= 1) {
    const cut = `${chars.slice(0, end).join("").trimEnd()}…`;
    if (textWidth(cut, fontSize) <= maxWidth) return cut;
  }
  return "…";
}
