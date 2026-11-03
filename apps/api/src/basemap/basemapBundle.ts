import { createHash } from "node:crypto";
import type { LocalBuild } from "../mapdata/localBuilds";
import type { BasemapArchive, StoredTile } from "./basemapArchive";

/** A build's `basemap.pmtiles`, open. */
export interface OpenBasemap {
  build: LocalBuild;
  archive: BasemapArchive;
}

/**
 * What the map draws (docs/design/self-hosted-maps.md §3.1, §3.3): the
 * basemap region's archive and, when the volume has it, the world overview.
 * `id` names the pair in the tile URLs, so that a new build of either is a
 * new URL and every tile can be cached for good.
 */
export interface BasemapBundle {
  id: string;
  region: OpenBasemap;
  world: OpenBasemap | null;
}

/** Sixteen hex digits of the SHA-256 of both builds' digests. */
export function bundleId(region: LocalBuild, world: LocalBuild | null): string {
  return createHash("sha256")
    .update(`${region.digest}\n${world?.digest ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

/** The highest zoom the world overview always answers instead of the region (§3.1). */
const worldZoomsUpTo = 4;

/**
 * The tile router's rule (docs/design/self-hosted-maps.md §3.1): a tile of
 * z ≤ 4 comes from the world overview — from the region while the volume has
 * no overview yet — since a region's low-zoom tiles hold only what touches
 * its bounding box; a tile of z ≥ 5 from the region, else from the overview
 * (z5–6 abroad), else nothing (null: the answer is 204).
 */
export async function bundleTile(
  bundle: BasemapBundle,
  z: number,
  x: number,
  y: number,
): Promise<StoredTile | null> {
  // Both archives are held before the first await: a look at the volume that
  // closes one of them between the two reads waits for this tile.
  const releases: (() => void)[] = [];
  try {
    releases.push(bundle.region.archive.acquire());
    if (bundle.world !== null) releases.push(bundle.world.archive.acquire());
    if (z <= worldZoomsUpTo) {
      return await (bundle.world ?? bundle.region).archive.tile(z, x, y);
    }
    const tile = await bundle.region.archive.tile(z, x, y);
    if (tile !== null || bundle.world === null) return tile;
    return await bundle.world.archive.tile(z, x, y);
  } finally {
    for (const release of releases) release();
  }
}
