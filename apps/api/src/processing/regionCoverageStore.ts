import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { type CoveragePolygon, type RegionCoverage, regionCoverage } from "./regionCoverage";

interface StateRow extends Record<string, unknown> {
  source: string;
  updated_at: string;
}

interface PolygonRow extends StateRow {
  polygon: CoveragePolygon;
}

/**
 * The coverage of the `ready` regions for a pass (docs/architecture.md §17.3):
 * one small query says which builds are ready; their polygons, the large part,
 * are read and parsed again only when that answer changes, and the corner
 * tests are remembered with them. A build swapped or dropped meanwhile is read
 * old or new in one statement; a region gone covers nothing.
 */
export class RegionCoverageStore {
  #state = "";
  #coverage: RegionCoverage = regionCoverage([]);

  /** Whether any region was ready when `current` last looked. */
  get ready(): boolean {
    return this.#state !== "";
  }

  async current(db: Executor): Promise<RegionCoverage> {
    const ready = await db.execute<StateRow>(
      sql`SELECT source, updated_at::text AS updated_at FROM osm_regions WHERE status = 'ready' ORDER BY source`,
    );
    const state = ready.rows.map((row) => `${row.source}@${row.updated_at}`).join("\n");
    if (state === this.#state) return this.#coverage;
    if (ready.rows.length === 0) {
      this.#state = state;
      this.#coverage = regionCoverage([]);
      return this.#coverage;
    }
    // Read with the polygons so that the state kept is the state of the polygons used.
    const read = await db.execute<PolygonRow>(sql`
      SELECT source, updated_at::text AS updated_at, polygon
      FROM osm_regions WHERE status = 'ready' ORDER BY source
    `);
    this.#state = read.rows.map((row) => `${row.source}@${row.updated_at}`).join("\n");
    this.#coverage = regionCoverage(read.rows.map((row) => row.polygon));
    return this.#coverage;
  }
}
