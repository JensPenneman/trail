import type { PoolClient } from "pg";
import { boundedLines, type LineLimits } from "./boundedLines";
import { quoteIdentifier } from "./buildPartitions";
import { CopyStream } from "./copyStream";
import { copyField } from "./copyText";
import { emptyPoiCounts, type PoiCounts, poiRows } from "./poiRows";
import { tileZoom } from "./wayTiles";

export interface LoadPoisInput {
  /** The text of pois.geojsonseq.gz, unpacked. */
  chunks: AsyncIterable<Uint8Array>;
  limits: LineLimits;
  /** The build's `osm_pois` table, created in this transaction. */
  table: string;
  source: string;
  /** The extract's timestamp, as `fetched_at`. */
  fetchedAt: Date;
  signal?: AbortSignal | undefined;
}

/** Streams pois.geojsonseq.gz into a build's `osm_pois` table with one `COPY … FREEZE`, like `loadWays`. */
export async function loadPois(client: PoolClient, input: LoadPoisInput): Promise<PoiCounts> {
  const counts = emptyPoiCounts();
  const fetchedAt = input.fetchedAt.toISOString();
  const copy = new CopyStream(
    client,
    `COPY ${quoteIdentifier(input.table)} (id, source, kind, lat, lon, name, z, x, y, fetched_at) FROM STDIN WITH (FREEZE)`,
  );
  try {
    for await (const lines of boundedLines(input.chunks, "pois.geojsonseq.gz", input.limits)) {
      input.signal?.throwIfAborted();
      for (const poi of poiRows(lines, counts)) {
        const name = poi.name === null ? "\\N" : copyField(poi.name);
        const row = `${poi.id}\t${input.source}\t${poi.kind}\t${poi.lat}\t${poi.lon}\t${name}\t${tileZoom}\t${poi.x}\t${poi.y}\t${fetchedAt}\n`;
        if (copy.add(row)) await copy.flush();
      }
    }
    await copy.end();
  } catch (error) {
    copy.abort(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
  return counts;
}
