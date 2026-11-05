/*
 * Colour maths for tests of palettes: WCAG contrast, OKLab distance and colour-vision-deficiency
 * simulation (Machado, Oliveira and Fernandes 2009, severity 1). No dependency, nothing in the app.
 */

type Rgb = readonly [number, number, number];

/** `#rrggbb` as 0–1 channels. */
export function rgbOf(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

const linear = (channel: number): number =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const gamma = (channel: number): number =>
  channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;

export const toLinear = (rgb: Rgb): Rgb => [linear(rgb[0]), linear(rgb[1]), linear(rgb[2])];

/** Relative luminance (WCAG 2). */
export function luminance(hex: string): number {
  const [r, g, b] = toLinear(rgbOf(hex));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio of two colours (WCAG 2), 1 to 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** OKLab (L, a, b) of a linear-light colour. */
function oklabOfLinear([r, g, b]: Rgb): Rgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Lightness of OKLab, 0 to 1. */
export const oklabL = (hex: string): number => oklabOfLinear(toLinear(rgbOf(hex)))[0];

type Matrix = readonly [Rgb, Rgb, Rgb];

const simulations: Readonly<Record<"protan" | "deutan" | "tritan", Matrix>> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

export type Deficiency = keyof typeof simulations;
export const deficiencies: readonly Deficiency[] = ["protan", "deutan", "tritan"];

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

/** The linear colour as someone with the deficiency sees it. */
function simulated(hex: string, deficiency: Deficiency | null): Rgb {
  const rgb = toLinear(rgbOf(hex));
  if (deficiency === null) return rgb;
  const matrix = simulations[deficiency];
  const row = (index: number): number =>
    clamp(
      (matrix[index]?.[0] ?? 0) * rgb[0] +
        (matrix[index]?.[1] ?? 0) * rgb[1] +
        (matrix[index]?.[2] ?? 0) * rgb[2],
    );
  return [row(0), row(1), row(2)];
}

/** The distance of two colours in OKLab, times 100, as seen with `deficiency` (or normally). */
export function deltaE(a: string, b: string, deficiency: Deficiency | null = null): number {
  const [l1, a1, b1] = oklabOfLinear(simulated(a, deficiency));
  const [l2, a2, b2] = oklabOfLinear(simulated(b, deficiency));
  return 100 * Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

export { gamma };
