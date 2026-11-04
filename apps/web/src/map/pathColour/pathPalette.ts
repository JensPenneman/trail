/**
 * The colours of the paths when they are not a device's or a mode's (docs/architecture.md §14),
 * as values MapLibre can use. The speed ramp runs slow to fast and every step keeps at least 3:1
 * against the map's palest background (light #f2f2f2, dark #303031) and a perceptual distance to
 * its neighbours, also under colour-vision deficiencies (`pathPalette.test.ts` computes both); the
 * time-of-day tones are four categories apart on the same measures. Colour is never the only cue:
 * the key names every class.
 */
export const speedRamp: Readonly<Record<"light" | "dark", readonly string[]>> = {
  light: ["#ad7c0e", "#b64a02", "#a11c4e", "#4d2f77", "#022c51"],
  dark: ["#089ac3", "#a495f0", "#fa94cf", "#fdc2a2", "#fcec8a"],
};

/** Night, morning, afternoon, evening. */
export const timeTones: Readonly<Record<"light" | "dark", readonly string[]>> = {
  light: ["#80868e", "#2a6fc4", "#c2501c", "#0b6b4a"],
  dark: ["#7d838c", "#5a9bef", "#f07c48", "#3fd69a"],
};
