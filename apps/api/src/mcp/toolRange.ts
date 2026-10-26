import { mcpLimits } from "@trail/contracts/mcp";
import { HttpError } from "../http/httpError";

/** `[from, to)` of a tool call as instants: `to` after `from`, at most `mcpLimits.maxRangeDays` apart. */
export function toolRange(from: string, to: string): { from: Date; to: Date } {
  const start = new Date(from);
  const end = new Date(to);
  if (end.getTime() <= start.getTime()) {
    throw new HttpError(400, "validation_failed", "`to` must be after `from`.");
  }
  if (end.getTime() - start.getTime() > mcpLimits.maxRangeDays * 86_400_000) {
    throw new HttpError(
      400,
      "validation_failed",
      `A call covers at most ${mcpLimits.maxRangeDays} days: narrow the range, or split it into several calls.`,
    );
  }
  return { from: start, to: end };
}

/** The first `mcpLimits.maxItems` items, and whether there were more. */
export function capItems<T>(items: readonly T[]): { items: T[]; truncated: boolean } {
  return {
    items: items.slice(0, mcpLimits.maxItems),
    truncated: items.length > mcpLimits.maxItems,
  };
}

/** The sentence a capped summary ends with. */
export const narrowTheRange = `Only the first ${mcpLimits.maxItems} are listed: narrow the range to see the rest.`;
