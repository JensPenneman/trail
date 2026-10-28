import type { PoolClient } from "pg";
import { boundedLines, type LineLimits } from "./boundedLines";
import { quoteIdentifier } from "./buildPartitions";
import { CopyStream } from "./copyStream";
import { copyField } from "./copyText";
import { emptyWayCounts, type WayCounts, type WayRow, wayRows } from "./wayRows";
import { tileOfNumber, tileZoom } from "./wayTiles";

export interface LoadWaysInput {
  /** The text of ways.opl.gz, unpacked. */
  chunks: AsyncIterable<Uint8Array>;
  limits: LineLimits;
  /** The build's `osm_ways` or `osm_tile_ways` table, created in this transaction. */
  table: string;
  source: string;
  /** The extract's timestamp, as `fetched_at`. */
  fetchedAt: Date;
  signal?: AbortSignal | undefined;
}

/** Streams the rows `rowsOf` makes of each way into one COPY of the table. */
async function copyWays(
  client: PoolClient,
  input: LoadWaysInput,
  statement: string,
  rowsOf: (way: WayRow, copy: CopyStream) => boolean,
): Promise<WayCounts> {
  const counts = emptyWayCounts();
  const copy = new CopyStream(client, statement);
  try {
    for await (const lines of boundedLines(input.chunks, "ways.opl.gz", input.limits)) {
      input.signal?.throwIfAborted();
      for (const way of wayRows(lines, counts)) {
        if (rowsOf(way, copy)) await copy.flush();
      }
    }
    await copy.end();
  } catch (error) {
    copy.abort(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
  return counts;
}

/**
 * Streams ways.opl.gz into a build's `osm_ways` table with one
 * `COPY … FREEZE` (docs/design/self-hosted-maps.md §2.2): the rows frozen as
 * they arrive, so no vacuum visits them again, and nothing held beyond a
 * chunk of the file and of the COPY.
 */
export function loadWays(client: PoolClient, input: LoadWaysInput): Promise<WayCounts> {
  const fetchedAt = input.fetchedAt.toISOString();
  return copyWays(
    client,
    input,
    `COPY ${quoteIdentifier(input.table)} (id, source, kind, tags, nodes, geometry, min_lat, min_lon, max_lat, max_lon, fetched_at) FROM STDIN WITH (FREEZE)`,
    (way, copy) =>
      copy.add(
        `${way.id}\t${input.source}\t${way.kind}\t${copyField(JSON.stringify(way.tags))}\t{${way.nodes.join(",")}}\t\\\\x${way.geometry.toString("hex")}\t${way.minLat}\t${way.minLon}\t${way.maxLat}\t${way.maxLon}\t${fetchedAt}\n`,
      ),
  );
}

/**
 * Streams the z14 tiles of the ways of ways.opl.gz into a build's
 * `osm_tile_ways` table with one `COPY … FREEZE`: a second read of the file,
 * since one connection runs one COPY at a time (the caller compares the two
 * reads' counts).
 */
export function loadWayTiles(client: PoolClient, input: LoadWaysInput): Promise<WayCounts> {
  return copyWays(
    client,
    input,
    `COPY ${quoteIdentifier(input.table)} (z, x, y, way_id, source) FROM STDIN WITH (FREEZE)`,
    (way, copy) => {
      let full = false;
      for (const tile of way.tiles) {
        const [x, y] = tileOfNumber(tile);
        full = copy.add(`${tileZoom}\t${x}\t${y}\t${way.id}\t${input.source}\n`) || full;
      }
      return full;
    },
  );
}
