/**
 * The heatmap's colours, from the fewest points to the most
 * (docs/architecture.md §14): pink to purple at even steps of lightness
 * (OKLCH), darker for more on a light map and brighter for more on a dark or
 * satellite one. Pink and purple are colours the basemaps hardly use (parks,
 * water and roads are green, blue, yellow and orange), the lightest step keeps
 * 2:1 against the light map's ground and the darkest 3:1 against the dark
 * map's, and neighbouring steps stay apart for protanopia and deuteranopia.
 */
export const heatRamp = {
  light: ["#e987b3", "#d65da1", "#bb3a95", "#952686", "#6b1a71", "#431256"],
  dark: ["#8c47a0", "#b452b9", "#d867c5", "#f188cc", "#feb2d8", "#ffdbeb"],
} as const;
