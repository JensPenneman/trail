import type { OverlandBatch, OverlandFeature } from "./overlandBatch";

const metresPerDegree = 111_195;
/** Near Ghent's Korenmarkt. */
const origin = { lat: 51.0543, lon: 3.7217 };
const metresPerLon = metresPerDegree * Math.cos((origin.lat * Math.PI) / 180);

interface Leg {
  seconds: number;
  /** Seconds between points. */
  every: number;
  /** Metres per second east and north. */
  east: number;
  north: number;
  motion: string[];
}

/** Overland's own timestamp format: whole seconds, UTC. */
const timestamp = (seconds: number) =>
  new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * A walk of twelve minutes, five minutes standing still and a drive of a
 * quarter of an hour, recorded every two seconds and ending `endsAgoS` before
 * `now`: two moves whose modes the server works out without map data, from
 * their speeds and the phone's motion readings — the suite's server has none.
 */
export function walkAndDrive(now = Date.now(), endsAgoS = 120): OverlandBatch {
  const legs: Leg[] = [
    { seconds: 12 * 60, every: 2, east: 1.4, north: 0, motion: ["walking"] },
    { seconds: 5 * 60, every: 10, east: 0, north: 0, motion: ["stationary"] },
    { seconds: 15 * 60, every: 2, east: 0, north: 13.9, motion: ["driving"] },
  ];
  const total = legs.reduce((sum, leg) => sum + leg.seconds, 0);
  let t = Math.floor(now / 1000) - endsAgoS - total;
  let x = 0;
  let y = 0;
  const locations: OverlandFeature[] = [];
  for (const leg of legs) {
    for (let elapsed = 0; elapsed < leg.seconds; elapsed += leg.every) {
      locations.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [
            Number((origin.lon + x / metresPerLon).toFixed(7)),
            Number((origin.lat + y / metresPerDegree).toFixed(7)),
          ],
        },
        properties: {
          timestamp: timestamp(t),
          horizontal_accuracy: 5,
          speed: Math.hypot(leg.east, leg.north),
          altitude: 8,
          vertical_accuracy: 4,
          motion: leg.motion,
          battery_level: 0.8,
          battery_state: "unplugged",
        },
      });
      t += leg.every;
      x += leg.east * leg.every;
      y += leg.north * leg.every;
    }
  }
  return { locations };
}
