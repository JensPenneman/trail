import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { toIso, toIsoOrNull } from "../db/toIso";

/** A region's build as `trail map status` and the worker's refresh (task 2) see it. */
export interface RegionRow {
  name: string;
  /** `yyyymmdd`, the UTC day of the extract. */
  buildId: string;
  /** The OCI manifest's digest, or the SHA-256 of manifest.json for a hand import. */
  digest: string;
  source: string;
  extractTimestamp: string;
  status: "importing" | "ready" | "failed";
  error: string | null;
  wayCount: number;
  membershipCount: number;
  poiCount: number;
  importedAt: string | null;
  updatedAt: string;
}

interface RegionLine extends Record<string, unknown> {
  name: string;
  build_id: string;
  digest: string;
  source: string;
  extract_timestamp: string;
  status: RegionRow["status"];
  error: string | null;
  way_count: number;
  membership_count: number;
  poi_count: number;
  imported_at: string | null;
  updated_at: string;
}

/** Every build of every region: by region, the ready one first, then the latest. */
export async function listRegionRows(db: Executor): Promise<RegionRow[]> {
  const result = await db.execute<RegionLine>(sql`
    SELECT name, build_id, digest, source, extract_timestamp, status, error, way_count,
      membership_count, poi_count, imported_at, updated_at
    FROM osm_regions
    ORDER BY name, status = 'ready' DESC, updated_at DESC, digest
  `);
  return result.rows.map((row) => ({
    name: row.name,
    buildId: row.build_id,
    digest: row.digest,
    source: row.source,
    extractTimestamp: toIso(row.extract_timestamp),
    status: row.status,
    error: row.error,
    wayCount: row.way_count,
    membershipCount: row.membership_count,
    poiCount: row.poi_count,
    importedAt: toIsoOrNull(row.imported_at),
    updatedAt: toIso(row.updated_at),
  }));
}
