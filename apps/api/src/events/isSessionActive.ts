import { and, eq, gt } from "drizzle-orm";
import type { Database } from "../db/database";
import { sessions } from "../db/schema/sessions";

/** Whether a session still exists and has not expired (checked by long-lived streams). */
export async function isSessionActive(db: Database, sessionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row !== undefined;
}
