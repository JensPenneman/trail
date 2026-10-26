import { haversineM } from "../tracks/haversine";
import type { OsmPoi, PoiKind } from "./mapData";

const cellDegrees = 0.01;

/** Stops and airports on a grid of about a kilometre, for "is there a station near here?". */
export class PoiIndex {
  readonly #cells = new Map<string, OsmPoi[]>();

  constructor(pois: readonly OsmPoi[]) {
    const sorted = [...pois].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const poi of sorted) {
      const key = `${Math.floor(poi.lat / cellDegrees)}:${Math.floor(poi.lon / cellDegrees)}`;
      const list = this.#cells.get(key);
      if (list === undefined) this.#cells.set(key, [poi]);
      else if (list.at(-1)?.id !== poi.id) list.push(poi);
    }
  }

  /** The nearest POI of one of `kinds` within `radiusM` of the position, or null. */
  nearest(
    position: { lat: number; lon: number },
    kinds: readonly PoiKind[],
    radiusM: number,
  ): OsmPoi | null {
    const latCells = Math.ceil(radiusM / 111_000 / cellDegrees);
    const lonCells = Math.ceil(
      radiusM / (111_000 * Math.max(0.05, Math.cos((position.lat * Math.PI) / 180))) / cellDegrees,
    );
    const baseLat = Math.floor(position.lat / cellDegrees);
    const baseLon = Math.floor(position.lon / cellDegrees);
    let best: OsmPoi | null = null;
    let bestDistance = radiusM;
    for (let dLat = -latCells; dLat <= latCells; dLat += 1) {
      for (let dLon = -lonCells; dLon <= lonCells; dLon += 1) {
        for (const poi of this.#cells.get(`${baseLat + dLat}:${baseLon + dLon}`) ?? []) {
          if (!kinds.includes(poi.kind)) continue;
          const distance = haversineM(position, poi);
          if (
            distance <= bestDistance &&
            (best === null || distance < bestDistance || poi.id < best.id)
          ) {
            best = poi;
            bestDistance = distance;
          }
        }
      }
    }
    return best;
  }
}
