/**
 * The heatmap's colours, from the fewest points to the most
 * (docs/architecture.md §14): pink to purple at even steps of lightness
 * (OKLCH), darker for more on a light map and brighter for more on a dark or
 * satellite one, drawn opaque. Pink and purple are colours the basemaps hardly
 * use (parks, water and roads are green, blue, yellow and orange). Against the
 * ground of OpenFreeMap's styles the lightest step of the light ramp has
 * 2.24:1 (#f8f4f0) and the darkest of the dark one 3.28:1 (#0c0c0c); the
 * lightness of neighbouring steps is 0.08 apart or more, their difference
 * ΔE (OKLab × 100) 8.9–10.0 and 8.4–10.1, and at least 7.0 and 6.6 for
 * protanopia, 8.9 and 7.9 for deuteranopia.
 */
export const heatRamp = {
  light: ["#e987b3", "#d65da1", "#bb3a95", "#952686", "#6b1a71", "#431256"],
  dark: ["#8c47a0", "#b452b9", "#d867c5", "#f188cc", "#feb2d8", "#ffdbeb"],
} as const;
