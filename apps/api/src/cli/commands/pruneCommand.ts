import { type PruneResult, pruneExpiredData } from "../../jobs/pruneExpiredData";
import type { CliContext } from "../cliContext";

/** The counts of the retention cleanup, as the command prints them. */
const lines: readonly (readonly [keyof PruneResult, string])[] = [
  ["sessions", "expired sessions"],
  ["ceremonies", "expired sign-in starts"],
  ["passkeyLinks", "old passkey links"],
  ["invites", "old invites"],
  ["apiTokens", "old API tokens"],
  ["shares", "old shares"],
  ["shareLinks", "old share links"],
  ["ingestLog", "upload log (> 90 days)"],
  ["dataAccessEvents", "data access log"],
  ["processingWorkers", "workers gone (> 1 hour)"],
];

/** `trail prune` — the hourly retention cleanup, now. */
export async function pruneCommand(ctx: CliContext): Promise<void> {
  const pruned = await pruneExpiredData(ctx.db, ctx.config);
  console.log("Removed:");
  for (const [kind, label] of lines) console.log(`  ${label.padEnd(24)}${pruned[kind]}`);
}
