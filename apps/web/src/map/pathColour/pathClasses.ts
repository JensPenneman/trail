/*
 * How a path is cut into classes for colouring (docs/architecture.md §14): the speed of each
 * interval between two points, smoothed, in bands; or the time of day it began in, in the
 * account's zone.
 */

/** A point of a track: `[lon, lat, t]` then, on the raw level, its speed, accuracy and altitude. */
export type PathPoint = readonly [number, number, number, ...(number | null)[]];

/** General bands in m/s: under 6 km/h, 6–15, 15–30, 30–70, 70 and more. */
export const speedBands: readonly number[] = [6, 15, 30, 70].map((kmh) => kmh / 3.6);

/** On foot the bands are paces: slower than 12:00 /km, 12:00–9:00, 9:00–7:00, 7:00–5:30, faster. */
export const paceBands: readonly number[] = [720, 540, 420, 330].map((seconds) => 1000 / seconds);

const earthRadiusM = 6_371_008.8;
const radians = (degrees: number): number => (degrees * Math.PI) / 180;

function metresBetween(a: PathPoint, b: PathPoint): number {
  const h =
    Math.sin(radians(b[1] - a[1]) / 2) ** 2 +
    Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(radians(b[0] - a[0]) / 2) ** 2;
  return 2 * earthRadiusM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The speed of each interval, m/s, null where none can be told. Raw points carry the phone's own
 * speed: the mean of the non-null ones at both ends, else distance over time; the other levels
 * have distance over time. An interval without time takes its neighbour's.
 */
export function edgeSpeeds(points: readonly PathPoint[], raw: boolean): (number | null)[] {
  const speeds: (number | null)[] = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (from === undefined || to === undefined) continue;
    const dt = to[2] - from[2];
    let speed: number | null = null;
    if (raw) {
      const own = [from[3], to[3]].filter(
        (value): value is number => typeof value === "number" && value >= 0,
      );
      if (own.length > 0) speed = own.reduce((sum, value) => sum + value, 0) / own.length;
    }
    if (speed === null && dt > 0) speed = metresBetween(from, to) / dt;
    speeds.push(speed);
  }
  // No time between two points: the interval before it, else the one after.
  for (let index = 0; index < speeds.length; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (speeds[index] !== null || from === undefined || to === undefined || to[2] - from[2] > 0) {
      continue;
    }
    speeds[index] =
      speeds[index - 1] ?? speeds.slice(index + 1).find((value) => value !== null) ?? null;
  }
  return speeds;
}

/** Each speed replaced by the median of itself and its neighbours (three intervals), nulls left out. */
export function smoothed(speeds: readonly (number | null)[]): (number | null)[] {
  return speeds.map((own, index) => {
    if (own === null) return null;
    const window = [speeds[index - 1], own, speeds[index + 1]]
      .filter((value): value is number => typeof value === "number")
      .sort((a, b) => a - b);
    return window[Math.floor(window.length / 2)] ?? own;
  });
}

/** The band of a speed: 0 for the slowest up to `bands.length` for the fastest. */
export function speedClassOf(speed: number, bands: readonly number[]): number {
  let index = 0;
  for (const edge of bands) if (speed >= edge) index += 1;
  return index;
}

const hourCache = new Map<string, Map<number, number>>();

/** The local hour (0–23) of an instant in `timeZone`, worked out once per UTC hour. */
function localHour(t: number, timeZone: string): number {
  let hours = hourCache.get(timeZone);
  if (hours === undefined) {
    hours = new Map();
    hourCache.set(timeZone, hours);
  }
  const key = Math.floor(t / 3600);
  const known = hours.get(key);
  if (known !== undefined) return known;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(
      new Date(t * 1000),
    ),
  );
  hours.set(key, hour);
  return hour;
}

/** Night 22–06 is 0, morning 06–12 is 1, afternoon 12–18 is 2, evening 18–22 is 3. */
export function timeClassOf(t: number, timeZone: string): number {
  const hour = localHour(t, timeZone);
  if (hour >= 22 || hour < 6) return 0;
  if (hour < 12) return 1;
  if (hour < 18) return 2;
  return 3;
}

/** The class of each interval of a path coloured by speed (null: unknown) or by time of day. */
export function edgeClasses(
  points: readonly PathPoint[],
  options: { by: "speed" | "time"; raw: boolean; onFoot: boolean; timeZone: string },
): (number | null)[] {
  if (options.by === "time") {
    return points.slice(0, -1).map((point) => timeClassOf(point[2], options.timeZone));
  }
  const bands = options.onFoot ? paceBands : speedBands;
  return smoothed(edgeSpeeds(points, options.raw)).map((speed) =>
    speed === null ? null : speedClassOf(speed, bands),
  );
}
