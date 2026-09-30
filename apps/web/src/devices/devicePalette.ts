/**
 * Categorical device colours (identity only — never status). Eight hues in a
 * fixed order that keeps neighbouring slots apart for protanopia and
 * deuteranopia, with a step per colour scheme so marks keep ≥ 3:1 against the
 * dark surface. Three light-mode slots sit below 3:1 on white, which is why a
 * device colour is never shown without the device name next to it. The same
 * values drive the CSS classes `device-color-0 … 7`.
 */
export const devicePalette = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
} as const;

export const devicePaletteSize = devicePalette.light.length;
