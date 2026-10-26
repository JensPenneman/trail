import type { WayClass } from "./mapData";
import { MinHeap } from "./minHeap";
import type { WayCandidate, WayIndex } from "./wayIndex";

/** A route as a polyline in projected metres; piece `k` (vertex k → k + 1) lies on way `ways[k]`. */
export interface RoutePath {
  xs: number[];
  ys: number[];
  ways: number[];
}

/**
 * The network of one way class (rail, tram, street or ferry) as a graph of OSM
 * nodes, for routes between map-matching candidates: ways that share a node
 * are connected there. Searches are bounded by distance and by way changes
 * (docs/architecture.md §17.3) and reuse their arrays between runs.
 */
export class WayGraph {
  readonly #index: WayIndex;
  readonly #wayClass: WayClass;
  /** Internal node of each vertex of each way (empty for ways of other classes). */
  readonly #vertexNodes: Int32Array[];
  readonly #nodeX: Float64Array;
  readonly #nodeY: Float64Array;
  readonly #edgeStart: Int32Array;
  readonly #edgeTo: Int32Array;
  readonly #edgeLength: Float64Array;
  readonly #edgeWay: Int32Array;
  // Search state, valid where #seen equals the current epoch.
  readonly #distance: Float64Array;
  readonly #hops: Int32Array;
  readonly #lastWay: Int32Array;
  readonly #previous: Int32Array;
  readonly #seen: Int32Array;
  readonly #settled: Int32Array;
  #epoch = 0;
  readonly #heap = new MinHeap();
  #source: WayCandidate | null = null;

  constructor(index: WayIndex, wayClass: WayClass) {
    this.#index = index;
    this.#wayClass = wayClass;
    const nodeOf = new Map<number, number>();
    const xs: number[] = [];
    const ys: number[] = [];
    this.#vertexNodes = index.ways.map((way) => {
      if (way.wayClass !== wayClass) return new Int32Array(0);
      const vertices = new Int32Array(way.nodes.length);
      for (const [vertex, nodeId] of way.nodes.entries()) {
        let node = nodeOf.get(nodeId);
        if (node === undefined) {
          node = xs.length;
          nodeOf.set(nodeId, node);
          xs.push(way.xs[vertex] ?? 0);
          ys.push(way.ys[vertex] ?? 0);
        }
        vertices[vertex] = node;
      }
      return vertices;
    });
    const nodeCount = xs.length;
    this.#nodeX = Float64Array.from(xs);
    this.#nodeY = Float64Array.from(ys);

    const degree = new Int32Array(nodeCount + 1);
    for (const [wayIndex, vertices] of this.#vertexNodes.entries()) {
      if (this.#index.ways[wayIndex] === undefined) continue;
      for (let vertex = 0; vertex < vertices.length - 1; vertex += 1) {
        const a = vertices[vertex] ?? 0;
        const b = vertices[vertex + 1] ?? 0;
        if (a === b) continue;
        degree[a] = (degree[a] ?? 0) + 1;
        degree[b] = (degree[b] ?? 0) + 1;
      }
    }
    this.#edgeStart = new Int32Array(nodeCount + 1);
    for (let node = 0; node < nodeCount; node += 1) {
      this.#edgeStart[node + 1] = (this.#edgeStart[node] ?? 0) + (degree[node] ?? 0);
    }
    const edgeCount = this.#edgeStart[nodeCount] ?? 0;
    this.#edgeTo = new Int32Array(edgeCount);
    this.#edgeLength = new Float64Array(edgeCount);
    this.#edgeWay = new Int32Array(edgeCount);
    const fill = Int32Array.from(this.#edgeStart.subarray(0, nodeCount));
    const add = (from: number, to: number, length: number, way: number) => {
      const slot = fill[from] ?? 0;
      fill[from] = slot + 1;
      this.#edgeTo[slot] = to;
      this.#edgeLength[slot] = length;
      this.#edgeWay[slot] = way;
    };
    for (const [wayIndex, vertices] of this.#vertexNodes.entries()) {
      const way = this.#index.ways[wayIndex];
      if (way === undefined) continue;
      for (let vertex = 0; vertex < vertices.length - 1; vertex += 1) {
        const a = vertices[vertex] ?? 0;
        const b = vertices[vertex + 1] ?? 0;
        if (a === b) continue;
        const length = (way.offsets[vertex + 1] ?? 0) - (way.offsets[vertex] ?? 0);
        add(a, b, length, wayIndex);
        add(b, a, length, wayIndex);
      }
    }
    this.#distance = new Float64Array(nodeCount);
    this.#hops = new Int32Array(nodeCount);
    this.#lastWay = new Int32Array(nodeCount);
    this.#previous = new Int32Array(nodeCount);
    this.#seen = new Int32Array(nodeCount);
    this.#settled = new Int32Array(nodeCount);
  }

  get wayClass(): WayClass {
    return this.#wayClass;
  }

  #segmentLength(candidate: WayCandidate): number {
    const way = this.#index.ways[candidate.way];
    if (way === undefined) return 0;
    return (way.offsets[candidate.segment + 1] ?? 0) - (way.offsets[candidate.segment] ?? 0);
  }

  #endsOf(candidate: WayCandidate): [number, number] {
    const vertices = this.#vertexNodes[candidate.way];
    return [vertices?.[candidate.segment] ?? -1, vertices?.[candidate.segment + 1] ?? -1];
  }

  #label(node: number, distance: number, hops: number, lastWay: number, previous: number): void {
    if (this.#seen[node] === this.#epoch && (this.#distance[node] ?? 0) <= distance) return;
    this.#seen[node] = this.#epoch;
    this.#distance[node] = distance;
    this.#hops[node] = hops;
    this.#lastWay[node] = lastWay;
    this.#previous[node] = previous;
    this.#heap.push(distance, node);
  }

  /**
   * Bounded Dijkstra from `source` until every node of `targets` is settled or
   * the search passes `bound` metres; then `distanceTo` and `pathTo` answer.
   */
  search(
    source: WayCandidate,
    targets: readonly WayCandidate[],
    bound: number,
    maxHops: number,
  ): void {
    this.#epoch += 1;
    this.#heap.clear();
    this.#source = source;
    const [a, b] = this.#endsOf(source);
    if (a < 0 || b < 0) return;
    const length = this.#segmentLength(source);
    this.#label(a, source.t * length, 0, source.way, -1);
    this.#label(b, (1 - source.t) * length, 0, source.way, -1);
    const pending = new Set<number>();
    for (const target of targets) {
      for (const node of this.#endsOf(target)) if (node >= 0) pending.add(node);
    }
    while (this.#heap.size > 0 && pending.size > 0) {
      if (this.#heap.peekCost() > bound) break;
      const node = this.#heap.pop();
      if (this.#settled[node] === this.#epoch) continue;
      this.#settled[node] = this.#epoch;
      pending.delete(node);
      const distance = this.#distance[node] ?? 0;
      const hops = this.#hops[node] ?? 0;
      const lastWay = this.#lastWay[node] ?? -1;
      const end = this.#edgeStart[node + 1] ?? 0;
      for (let edge = this.#edgeStart[node] ?? 0; edge < end; edge += 1) {
        const to = this.#edgeTo[edge] ?? 0;
        if (this.#settled[to] === this.#epoch) continue;
        const way = this.#edgeWay[edge] ?? 0;
        const nextHops = hops + (way === lastWay ? 0 : 1);
        if (nextHops > maxHops) continue;
        const nextDistance = distance + (this.#edgeLength[edge] ?? 0);
        if (nextDistance > bound) continue;
        this.#label(to, nextDistance, nextHops, way, edge);
      }
    }
  }

  #reached(node: number): boolean {
    return node >= 0 && this.#settled[node] === this.#epoch;
  }

  /** Route length from the last search's source to `target` (Infinity when out of reach). */
  distanceTo(target: WayCandidate): number {
    const source = this.#source;
    if (source === null) return Number.POSITIVE_INFINITY;
    if (target.way === source.way && target.segment === source.segment) {
      return Math.abs(target.t - source.t) * this.#segmentLength(source);
    }
    const [a, b] = this.#endsOf(target);
    const length = this.#segmentLength(target);
    let best = Number.POSITIVE_INFINITY;
    if (this.#reached(a)) best = Math.min(best, (this.#distance[a] ?? 0) + target.t * length);
    if (this.#reached(b)) best = Math.min(best, (this.#distance[b] ?? 0) + (1 - target.t) * length);
    return best;
  }

  /** The route of the last search to `target` as a polyline, or null when out of reach. */
  pathTo(target: WayCandidate): RoutePath | null {
    const source = this.#source;
    if (source === null) return null;
    if (target.way === source.way && target.segment === source.segment) {
      return { xs: [source.x, target.x], ys: [source.y, target.y], ways: [source.way] };
    }
    const [a, b] = this.#endsOf(target);
    const length = this.#segmentLength(target);
    const viaA = this.#reached(a)
      ? (this.#distance[a] ?? 0) + target.t * length
      : Number.POSITIVE_INFINITY;
    const viaB = this.#reached(b)
      ? (this.#distance[b] ?? 0) + (1 - target.t) * length
      : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(Math.min(viaA, viaB))) return null;
    const entry = viaA <= viaB ? a : b;
    const nodes: number[] = [];
    const ways: number[] = [];
    for (let node = entry; node >= 0; ) {
      nodes.push(node);
      const edge = this.#previous[node] ?? -1;
      if (edge < 0) break;
      ways.push(this.#edgeWay[edge] ?? source.way);
      node = this.#fromOf(edge);
    }
    nodes.reverse();
    ways.reverse();
    const xs = [source.x];
    const ys = [source.y];
    const pieceWays = [source.way];
    for (const [position, node] of nodes.entries()) {
      xs.push(this.#nodeX[node] ?? 0);
      ys.push(this.#nodeY[node] ?? 0);
      if (position > 0) pieceWays.push(ways[position - 1] ?? source.way);
    }
    xs.push(target.x);
    ys.push(target.y);
    pieceWays.push(target.way);
    return { xs, ys, ways: pieceWays };
  }

  /** The node an edge starts at (edges are stored per start node). */
  #fromOf(edge: number): number {
    let low = 0;
    let high = this.#edgeStart.length - 2;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((this.#edgeStart[middle] ?? 0) <= edge) low = middle;
      else high = middle - 1;
    }
    return low;
  }
}
