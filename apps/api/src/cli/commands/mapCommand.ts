import { parseArgs } from "node:util";
import { isRegionName } from "../../mapdata/regionName";
import type { CliContext } from "../cliContext";
import { UsageError } from "../usageError";
import { mapImportCommand } from "./mapImportCommand";
import { mapRefreshCommand } from "./mapRefreshCommand";
import { mapStatusCommand } from "./mapStatusCommand";

/** `trail map <command>`: checks the arguments before any database work. */
export function mapCommand(args: string[]): (ctx: CliContext) => Promise<void> {
  const [verb, ...rest] = args;
  if (verb === "import") {
    const { positionals } = parseArgs({ args: rest, allowPositionals: true, options: {} });
    const [dir] = positionals;
    if (dir === undefined || positionals.length !== 1) {
      throw new UsageError("map import takes exactly one directory");
    }
    return (ctx) => mapImportCommand(ctx, dir);
  }
  if (verb === "refresh") {
    const { positionals } = parseArgs({ args: rest, allowPositionals: true, options: {} });
    if (positionals.length > 1) throw new UsageError("map refresh takes one region at most");
    const [region] = positionals;
    if (region !== undefined && !isRegionName(region)) {
      throw new UsageError(`"${region}" is not a region: lowercase letters, digits and dashes`);
    }
    return (ctx) => mapRefreshCommand(ctx, region);
  }
  if (verb === "status") {
    parseArgs({ args: rest, options: {} });
    return (ctx) => mapStatusCommand(ctx);
  }
  throw new UsageError(
    verb === undefined
      ? "map needs a command: import, refresh or status"
      : `unknown map command "${verb}"`,
  );
}
