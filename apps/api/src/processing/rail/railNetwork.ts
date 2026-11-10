import type { WayKind } from "@trail/contracts/transport";
import type { WayClass } from "../mapData";
import { WayGraph } from "../wayGraph";
import { kindBits, type WayIndex } from "../wayIndex";

/**
 * A network the alignment lays points on: the way kinds that belong to it and
 * which services of them are not main tracks. The train's is `trainNetwork`;
 * metro (`subway`) or tram would be another definition with the same core.
 */
export interface RailNetwork {
  /** The graph's way class (routes stay inside one class). */
  readonly wayClass: WayClass;
  readonly kinds: readonly WayKind[];
  /** OSM `service` values of ways that are no main track (a yard, a siding, a spur). */
  readonly sideServices: readonly string[];
}

/** Trains run on `railway=rail`: not on metro, light rail or tram, which have their own kinds. */
export const trainNetwork: RailNetwork = {
  wayClass: "rail",
  kinds: ["rail"],
  // A crossover joins two main tracks and is no side track.
  sideServices: ["yard", "siding", "spur"],
};

/** A network over the ways of one piece: the index, the kind mask and the graph (built when first needed). */
export interface RailContext {
  readonly index: WayIndex;
  readonly network: RailNetwork;
  /** Bits of `kindBits` for the network's kinds, for `WayIndex.candidates`. */
  readonly kindMask: number;
  /** The routing graph: built on first use, so a piece without a run never pays for it. */
  graph(): WayGraph;
}

export function railContext(index: WayIndex, network: RailNetwork): RailContext {
  let graph: WayGraph | null = null;
  return {
    index,
    network,
    kindMask: network.kinds.reduce((mask, kind) => mask | kindBits[kind], 0),
    graph: () => {
      graph ??= new WayGraph(index, network.wayClass, network.kinds);
      return graph;
    },
  };
}
