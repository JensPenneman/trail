const earthRadiusM = 6_371_008.8;
const radians = Math.PI / 180;

/**
 * Equirectangular projection around one latitude: metres east (x) and north (y)
 * of a reference point. Within the few hundred kilometres of a day's window the
 * scale error stays at a few per cent, far below what map matching tolerates,
 * and it makes distances to ways plain 2D geometry.
 */
export class LocalProjection {
  readonly #lat0: number;
  readonly #lon0: number;
  readonly #kx: number;
  readonly #ky = earthRadiusM * radians;

  constructor(lat0: number, lon0: number) {
    this.#lat0 = lat0;
    this.#lon0 = lon0;
    this.#kx = earthRadiusM * radians * Math.cos(lat0 * radians);
  }

  /** Around the mean position of `points` (the origin for none). */
  static around(points: Iterable<{ lat: number; lon: number }>): LocalProjection {
    let lat = 0;
    let lon = 0;
    let count = 0;
    for (const point of points) {
      lat += point.lat;
      lon += point.lon;
      count += 1;
    }
    return count === 0 ? new LocalProjection(0, 0) : new LocalProjection(lat / count, lon / count);
  }

  x(lon: number): number {
    return (lon - this.#lon0) * this.#kx;
  }

  y(lat: number): number {
    return (lat - this.#lat0) * this.#ky;
  }

  lon(x: number): number {
    return this.#lon0 + x / this.#kx;
  }

  lat(y: number): number {
    return this.#lat0 + y / this.#ky;
  }
}
