import { rmSync } from "node:fs";
import type { Database } from "../../src/db/database";
import { createLogger } from "../../src/logging/createLogger";
import { importRegion } from "../../src/mapdata/importRegion";
import { writeArtefact } from "./mapDataArtefact";
import { oplLinesOf, railWorld, regionPolyText } from "./railWorld";
import { toLonLat } from "./syntheticWorld";

const logger = createLogger({ level: "silent" });
const directories: string[] = [];

/**
 * Imports the rail world as one region build whose polygon covers `westM` to `eastM` metres east
 * of the world's origin (all of its latitudes), as `trail map import` would; without railways when
 * asked, as a build of the same extract that holds none.
 */
export async function importRailRegion(
  db: Database,
  extent: { westM: number; eastM: number },
  withRails = true,
): Promise<void> {
  const [west] = toLonLat(extent.westM, 0);
  const [east] = toLonLat(extent.eastM, 0);
  const lines = oplLinesOf(railWorld()).filter((line) => withRails || !line.includes("railway="));
  const dir = writeArtefact({
    ways: () => lines,
    pois: () => [],
    polygon: regionPolyText("rail-world", [
      [west, 50.9],
      [east, 50.9],
      [east, 51.2],
      [west, 51.2],
    ]),
  });
  directories.push(dir);
  await importRegion({ db, logger, dir, digest: null });
}

/** Removes the build directories written so far. */
export function removeRailRegionBuilds(): void {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
}
