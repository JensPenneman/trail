import { sql } from "drizzle-orm";
import type { Executor } from "../db/database";

/**
 * Which of `sessionIds` still exist and have not expired: the session
 * re-check of every open live stream at once, one statement per tick however
 * many streams are open (docs/architecture.md §9).
 */
export async function activeSessions(
  db: Executor,
  sessionIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (sessionIds.length === 0) return new Set();
  const result = await db.execute<{ id: string }>(sql`
    SELECT id FROM sessions
    WHERE id = ANY(${sql.param(sessionIds)}::text[]) AND expires_at > now()
  `);
  return new Set(result.rows.map((row) => row.id));
}
