import { and, eq } from "drizzle-orm";
import type { Executor } from "../db/database";
import { hiddenPeople } from "../db/schema/hiddenPeople";

/** Since when `userId` hides `hiddenUserId`, or null: what a share bound between them starts with. */
export async function hiddenSince(
  tx: Executor,
  userId: string,
  hiddenUserId: string,
): Promise<Date | null> {
  const [row] = await tx
    .select({ hiddenAt: hiddenPeople.hiddenAt })
    .from(hiddenPeople)
    .where(and(eq(hiddenPeople.userId, userId), eq(hiddenPeople.hiddenUserId, hiddenUserId)))
    .limit(1);
  return row?.hiddenAt ?? null;
}
