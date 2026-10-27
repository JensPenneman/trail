/*
 * How Insights rounds what it answers: metres to a decimetre (as
 * `GET /api/v1/stats/modes` does), seconds whole, speeds to a tenth of a km/h,
 * shares to three decimals. Sums are taken first and rounded once.
 */

export const roundMetres = (metres: number): number => Math.round(metres * 10) / 10;
export const roundSeconds = (seconds: number): number => Math.round(seconds);
export const roundKmh = (kmh: number): number => Math.round(kmh * 10) / 10;
const roundShare = (share: number): number => Math.round(share * 1000) / 1000;

/** Distance over time in km/h; 0 without time. */
export const speedKmh = (metres: number, seconds: number): number =>
  seconds > 0 ? roundKmh((metres / seconds) * 3.6) : 0;

/** `part` of `whole`, 0 to 1; 0 when there is no whole. */
export const shareOf = (part: number, whole: number): number =>
  whole > 0 ? roundShare(Math.min(1, part / whole)) : 0;
