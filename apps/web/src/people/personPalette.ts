/**
 * Identity colours of people (never status), a second ring next to the device
 * palette: deeper and greyer hues, so another person's marks do not pass for
 * one's own devices. Every value keeps at least 4:1 against the surfaces as a
 * mark; a person's colour is always shown next to their name or initials.
 * The same values drive the CSS classes `person-color-0 … 7`.
 */
export const personPalette = {
  light: ["#00838f", "#8e24aa", "#c2185b", "#8d6e63", "#827717", "#546e7a", "#bf360c", "#0277bd"],
  dark: ["#26c6da", "#ce93d8", "#f48fb1", "#bcaaa4", "#c0ca33", "#90a4ae", "#ff8a65", "#4fc3f7"],
} as const;

export const personPaletteSize = personPalette.light.length;
