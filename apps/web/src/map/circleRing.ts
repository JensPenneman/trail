const earthRadiusM = 6_371_008.8;

/**
 * A closed ring approximating a circle of `radiusM` metres around a point, on
 * the sphere — so an accuracy circle keeps its true size at every zoom level
 * and latitude.
 */
export function circleRing(
  lon: number,
  lat: number,
  radiusM: number,
  steps = 64,
): [number, number][] {
  const angular = radiusM / earthRadiusM;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const ring: [number, number][] = [];
  for (let step = 0; step <= steps; step += 1) {
    const bearing = (2 * Math.PI * step) / steps;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
        Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
      );
    ring.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return ring;
}
