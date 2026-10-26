import { and, eq, sql } from "drizzle-orm";
import type { Transaction } from "../db/database";
import { apiTokens } from "../db/schema/apiTokens";

/**
 * Takes a deleted device out of the user's token restrictions, in the
 * deletion's transaction (there is no foreign key into an array). A list that
 * becomes empty stays an empty list — a token for no device — and never turns
 * into null, which would mean every device.
 */
export async function forgetDeviceInTokens(
  tx: Transaction,
  userId: string,
  deviceId: string,
): Promise<void> {
  await tx
    .update(apiTokens)
    .set({ deviceIds: sql`array_remove(${apiTokens.deviceIds}, ${deviceId}::uuid)` })
    .where(and(eq(apiTokens.userId, userId), sql`${deviceId}::uuid = ANY(${apiTokens.deviceIds})`));
}
