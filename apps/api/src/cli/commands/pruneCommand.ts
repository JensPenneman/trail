import { pruneExpiredData } from "../../jobs/pruneExpiredData";
import type { CliContext } from "../cliContext";

/** `trail prune` — the hourly retention cleanup, now. */
export async function pruneCommand(ctx: CliContext): Promise<void> {
  const pruned = await pruneExpiredData(ctx.db);
  console.log("Removed:");
  console.log(`  expired sessions        ${pruned.sessions}`);
  console.log(`  expired sign-in starts  ${pruned.ceremonies}`);
  console.log(`  old passkey links       ${pruned.passkeyLinks}`);
  console.log(`  old invites             ${pruned.invites}`);
  console.log(`  upload log (> 90 days)  ${pruned.ingestLog}`);
}
