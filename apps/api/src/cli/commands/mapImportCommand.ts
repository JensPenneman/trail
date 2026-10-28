import { type ImportStep, importRegion } from "../../mapdata/importRegion";
import type { CliContext } from "../cliContext";

const stepLines: Readonly<Record<ImportStep, string>> = {
  verified: "files match manifest.json",
  loaded: "ways and stops loaded",
  indexed: "keys built",
  locked: "swapping in",
  committed: "swapped in",
  swept: "old build removed",
};

/** `trail map import <dir>` — imports a region's build from its directory and swaps it in. */
export async function mapImportCommand(ctx: CliContext, dir: string): Promise<void> {
  const result = await importRegion({
    db: ctx.db,
    logger: ctx.logger,
    dir,
    digest: null,
    onStep: (step) => {
      console.error(`  ${stepLines[step]}`);
    },
  });
  if (!result.imported) {
    console.log(`${result.region}: build ${result.buildId} (${result.digest}) is imported already`);
    return;
  }
  console.log(
    `${result.region}: build ${result.buildId} imported in ${result.seconds.toFixed(1)} s`,
  );
  console.log(
    `  ${result.ways} ways in ${result.memberships} tile memberships, ${result.pois} stops`,
  );
  const { dropped } = result;
  if (dropped.ways + dropped.unclassifiedWays + dropped.pois + dropped.unclassifiedPois > 0) {
    console.log(
      `  left out: ${dropped.ways} unreadable and ${dropped.unclassifiedWays} other ways, ${dropped.pois} unreadable and ${dropped.unclassifiedPois} other stops`,
    );
  }
  console.log(`  source ${result.source}, digest ${result.digest}`);
  if (result.replaced.length > 0) console.log(`  replaced ${result.replaced.join(", ")}`);
}
