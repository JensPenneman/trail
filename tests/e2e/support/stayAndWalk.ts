import type { OverlandBatch, OverlandFeature } from "./overlandBatch";

const metresPerDegree = 111_195;
/** Near Ghent-Sint-Pieters. */
const origin = { lat: 51.0362, lon: 3.7104 };
const metresPerLon = metresPerDegree * Math.cos((origin.lat * Math.PI) / 180);

/** Overland's own timestamp format: whole seconds, UTC. */
const timestamp = (seconds: number) =>
  new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * A walk of six minutes, a stay of twenty-five minutes standing in one spot
 * and a walk of three minutes away, recorded every five seconds and ending
 * two minutes before `now`: one stop, which is a place.
 */
export function stayAndWalk(now = Date.now()): OverlandBatch {
  const legs = [
    { seconds: 6 * 60, east: 1.4, motion: "walking" },
    { seconds: 25 * 60, east: 0, motion: "stationary" },
    { seconds: 3 * 60, east: 1.4, motion: "walking" },
  ];
  const total = legs.reduce((sum, leg) => sum + leg.seconds, 0);
  let t = Math.floor(now / 1000) - 120 - total;
  let x = 0;
  const locations: OverlandFeature[] = [];
  for (const leg of legs) {
    for (let elapsed = 0; elapsed < leg.seconds; elapsed += 5) {
      locations.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [
            Number((origin.lon + x / metresPerLon).toFixed(7)),
            Number(origin.lat.toFixed(7)),
          ],
        },
        properties: {
          timestamp: timestamp(t),
          horizontal_accuracy: 5,
          speed: leg.east,
          motion: [leg.motion],
        },
      });
      t += 5;
      x += leg.east * 5;
    }
  }
  return { locations };
}
