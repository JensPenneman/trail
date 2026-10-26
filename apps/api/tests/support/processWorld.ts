import type { MapData, OsmPoi, OsmWay } from "../../src/processing/mapData";
import type {
  ManualTrip,
  OverrideSpan,
  RawPoint,
  VisitSpan,
} from "../../src/processing/pipelineTypes";
import {
  defaultProcessingConfig,
  type ProcessingConfig,
} from "../../src/processing/processingConfig";
import {
  finishWindow,
  inferWindow,
  mapPiece,
  piecesToMap,
  planWindow,
  type StretchMapping,
  type WindowPlan,
  type WindowResult,
} from "../../src/processing/runPipeline";
import { parseTileKey, type TileKey } from "../../src/processing/tileCover";
import { FixtureWaySource } from "./fixtureWaySource";
import { worldMap } from "./syntheticWorld";

/** Runs the whole pipeline over points in the synthetic world, every tile available. */
export function processWorld(
  points: readonly RawPoint[],
  options: {
    visits?: readonly VisitSpan[];
    trips?: readonly ManualTrip[];
    overrides?: readonly OverrideSpan[];
    /** False: no map data at all (mapping switched off). */
    withMap?: boolean;
    config?: ProcessingConfig;
  } = {},
): WindowResult {
  const config = options.config ?? defaultProcessingConfig;
  const plan = planWindow(points, options.visits ?? [], config);
  const withMap = options.withMap ?? true;
  return finishWindow(
    plan,
    {
      trips: options.trips ?? [],
      overrides: options.overrides ?? [],
      map: withMap ? worldMap() : null,
      available: withMap ? plan.tiles : new Set(),
    },
    config,
  );
}

export const moves = (result: WindowResult) =>
  result.segments.filter((segment) => segment.kind === "move");
export const stops = (result: WindowResult) =>
  result.segments.filter((segment) => segment.kind === "stop");

/** The configuration with another piece budget (`mapping.pieceMaxTiles`). */
export const withPieceBudget = (
  pieceMaxTiles: number,
  config: ProcessingConfig = defaultProcessingConfig,
): ProcessingConfig => ({ ...config, mapping: { ...config.mapping, pieceMaxTiles } });

/** The map data of some tiles as the tile cache holds it: cut from the fixture, tile by tile. */
async function tilesMapData(tiles: Iterable<TileKey>, source: FixtureWaySource): Promise<MapData> {
  const ways = new Map<number, OsmWay>();
  const pois = new Map<string, OsmPoi>();
  for (const key of [...tiles].sort()) {
    const tile = parseTileKey(key);
    if (tile === null) continue;
    const data = await source.fetchTile(tile);
    for (const way of data.ways) {
      ways.set(way.id, {
        id: way.id,
        kind: way.kind,
        nodes: way.nodes,
        geometry: way.geometry,
        name: way.name,
      });
    }
    for (const poi of data.pois) pois.set(poi.id, poi);
  }
  return { ways: [...ways.values()], pois: [...pois.values()] };
}

/**
 * Runs the pipeline as the worker does: every tile cached, each piece's map
 * data loaded on its own (only the ways and stops of its tiles).
 */
export async function processWorldInPieces(
  points: readonly RawPoint[],
  config: ProcessingConfig = defaultProcessingConfig,
): Promise<{ plan: WindowPlan; result: WindowResult }> {
  const source = new FixtureWaySource();
  const plan = planWindow(points, [], config);
  const mappings: StretchMapping[] = [];
  for (const piece of piecesToMap(plan, plan.tiles)) {
    mappings.push(
      ...mapPiece(plan, piece, await tilesMapData(piece.tiles, source), undefined, config),
    );
  }
  const result = inferWindow(
    plan,
    mappings,
    { trips: [], overrides: [], mapping: true, available: plan.tiles },
    config,
  );
  return { plan, result };
}
