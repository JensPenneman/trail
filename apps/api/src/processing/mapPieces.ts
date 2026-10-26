import { haversineM } from "../tracks/haversine";
import type { KeptPoint } from "./keptPoint";
import type { ProcessingConfig } from "./processingConfig";
import { positionTiles, stretchTiles, type TileKey } from "./tileCover";

/** A move of a window: positions `first..last` among its kept points. */
export interface PlannedMove {
  first: number;
  last: number;
  /** Faster than anything on the ground: no map data, off the network. */
  airborne: boolean;
  /** The tiles it needs (none when airborne). */
  tiles: Set<TileKey>;
}

/**
 * Positions `first..last` of a move (positions in the move) that one piece of
 * map data decides, matched over `from..to`: a margin of the move on each side
 * of a seam, so the stretch is matched as the whole move would be there. The
 * interval into `first` (from the point before) belongs to the stretch too.
 */
export interface Stretch {
  /** The move's number among the window's moves. */
  move: number;
  first: number;
  last: number;
  from: number;
  to: number;
  /** The tiles of `from..to`. */
  tiles: Set<TileKey>;
}

/** Map data loaded and indexed together. */
export interface MapPiece {
  stretches: Stretch[];
  tiles: Set<TileKey>;
}

const newTiles = (tiles: ReadonlySet<TileKey>, known: ReadonlySet<TileKey>): number => {
  let count = 0;
  for (const tile of tiles) if (!known.has(tile)) count += 1;
  return count;
};

/** Cuts a move that needs more than `budget` tiles into stretches of about that many. */
function cutMove(points: readonly KeptPoint[], move: number, config: ProcessingConfig): Stretch[] {
  const budget = config.mapping.pieceMaxTiles;
  const ranges: [number, number][] = [];
  let start = 0;
  let tiles = positionTiles(points, 0, false, config);
  for (let k = 1; k < points.length; k += 1) {
    const adds = positionTiles(points, k, true, config);
    if (tiles.size + newTiles(adds, tiles) > budget) {
      ranges.push([start, k - 1]);
      start = k;
      tiles = adds;
    } else {
      for (const tile of adds) tiles.add(tile);
    }
  }
  ranges.push([start, points.length - 1]);

  const along = new Float64Array(points.length);
  for (let k = 1; k < points.length; k += 1) {
    const from = points[k - 1];
    const to = points[k];
    along[k] =
      (along[k - 1] ?? 0) + (from === undefined || to === undefined ? 0 : haversineM(from, to));
  }
  const margin = config.mapping.seamMarginM;
  const last = points.length - 1;
  return ranges.map(([first, end]) => {
    let from = first;
    while (from > 0 && (along[first] ?? 0) - (along[from] ?? 0) < margin) from -= 1;
    let to = end;
    while (to < last && (along[to] ?? 0) - (along[end] ?? 0) < margin) to += 1;
    return { move, first, last: end, from, to, tiles: stretchTiles(points, from, to, config) };
  });
}

/**
 * How a window's map data is loaded (docs/architecture.md §17.3, mapped): a
 * piece at a time, so a long window never holds all of it. Moves go together
 * while their tiles stay within `mapping.pieceMaxTiles`; a move that needs more
 * is cut into stretches of about that many, each a piece of its own. Flights
 * need no map data.
 */
export function planPieces(
  kept: readonly KeptPoint[],
  moves: readonly PlannedMove[],
  config: ProcessingConfig,
): MapPiece[] {
  const budget = config.mapping.pieceMaxTiles;
  const pieces: MapPiece[] = [];
  let open: MapPiece | null = null;
  for (const [number, move] of moves.entries()) {
    if (move.airborne) continue;
    const count = move.last - move.first + 1;
    if (move.tiles.size <= budget) {
      const stretch: Stretch = {
        move: number,
        first: 0,
        last: count - 1,
        from: 0,
        to: count - 1,
        tiles: move.tiles,
      };
      if (open !== null && open.tiles.size + newTiles(move.tiles, open.tiles) <= budget) {
        open.stretches.push(stretch);
        for (const tile of move.tiles) open.tiles.add(tile);
      } else {
        open = { stretches: [stretch], tiles: new Set(move.tiles) };
        pieces.push(open);
      }
      continue;
    }
    open = null;
    for (const stretch of cutMove(kept.slice(move.first, move.last + 1), number, config)) {
      pieces.push({ stretches: [stretch], tiles: stretch.tiles });
    }
  }
  return pieces;
}
