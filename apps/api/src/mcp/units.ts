/** m/s as km/h with one decimal; null stays null, and so does a negative (invalid) reading. */
export const kmh = (metresPerSecond: number | null): number | null =>
  metresPerSecond === null || metresPerSecond < 0 ? null : Math.round(metresPerSecond * 36) / 10;

/** A measurement with one decimal: enough for metres and degrees of direction. */
export const oneDecimal = (value: number | null): number | null =>
  value === null ? null : Math.round(value * 10) / 10;

/** Whole seconds between two instants (`to` minus `from`). */
export const secondsBetween = (from: Date, to: Date): number =>
  Math.round((to.getTime() - from.getTime()) / 1000);
