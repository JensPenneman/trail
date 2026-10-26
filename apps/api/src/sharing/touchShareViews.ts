import { sql } from "drizzle-orm";
import type { AppContext } from "../appContext";

/**
 * Stamps when the recipient last looked (the owner sees it), at most once a
 * minute per share and after the response: a look never waits for a write.
 */
export function touchShareViews(ctx: AppContext, shareIds: readonly string[]): void {
  if (shareIds.length === 0) return;
  ctx.background.run("stamp share views", async () => {
    await ctx.db.execute(sql`
      UPDATE shares SET last_viewed_at = now()
      WHERE id = ANY(${sql.param([...shareIds])}::uuid[])
        AND (last_viewed_at IS NULL OR last_viewed_at < now() - interval '1 minute')
    `);
  });
}
