import type { createShareRequestSchema, OutgoingShare } from "@trail/contracts/share";
import { and, count, eq, isNull, lte, sql } from "drizzle-orm";
import type { z } from "zod";
import type { AppContext } from "../appContext";
import type { RequestAuth } from "../auth/requestAuth";
import { isUniqueViolation } from "../db/isUniqueViolation";
import { shares } from "../db/schema/shares";
import { users } from "../db/schema/users";
import { HttpError } from "../http/httpError";
import { announceShareChange } from "./announceShareChange";
import { currentShare } from "./currentShare";
import { toOutgoingShare } from "./outgoingShares";
import { assertOwnDevices, assertTokenMayShare } from "./shareableDevices";
import { shareExpiresAt } from "./shareExpiry";
import { maxCurrentShares } from "./shareLimits";

type CreateShare = z.output<typeof createShareRequestSchema>;

/**
 * Starts sharing the principal's location with an address
 * (docs/architecture.md §8.4). An address with an account is bound at once;
 * otherwise the share waits for someone to sign up with it. One current share
 * per address (an ended one is stopped to make room) and at most
 * `maxCurrentShares` at a time.
 */
export async function startShare(
  ctx: AppContext,
  auth: RequestAuth,
  request: CreateShare,
): Promise<OutgoingShare> {
  const owner = auth.user;
  if (request.email === owner.email) {
    throw new HttpError(400, "validation_failed", "You cannot share your location with yourself.", {
      email: ["This is your own address"],
    });
  }
  const deviceIds = request.deviceIds ?? null;
  assertTokenMayShare(auth, deviceIds);
  await assertOwnDevices(ctx.db, auth, deviceIds);
  const now = new Date();

  const created = await ctx.db.transaction(async (tx) => {
    // One owner's shares change one at a time, so the limit holds under concurrent requests.
    await tx.execute(sql`SELECT 1 FROM users WHERE id = ${owner.id} FOR UPDATE`);
    await tx
      .update(shares)
      .set({ revokedAt: now })
      .where(
        and(
          eq(shares.ownerUserId, owner.id),
          eq(shares.recipientEmail, request.email),
          isNull(shares.revokedAt),
          lte(shares.expiresAt, now),
        ),
      );
    const [current] = await tx
      .select({ total: count() })
      .from(shares)
      .where(and(eq(shares.ownerUserId, owner.id), currentShare(now)));
    if ((current?.total ?? 0) >= maxCurrentShares) {
      throw new HttpError(
        409,
        "conflict",
        `You already share with ${maxCurrentShares} people. Stop one of those shares first.`,
      );
    }
    const [recipient] = await tx
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.email, request.email))
      .limit(1);
    try {
      const [row] = await tx
        .insert(shares)
        .values({
          ownerUserId: owner.id,
          recipientEmail: request.email,
          recipientUserId: recipient?.id ?? null,
          deviceIds,
          precision: request.precision,
          historyDays: request.historyDays ?? null,
          includeDetails: request.includeDetails ?? true,
          expiresAt: shareExpiresAt(request.duration, now, owner.timezone),
          createdAt: now,
        })
        .returning();
      if (row === undefined) throw new Error("Storing the share returned no row");
      return { row, recipientName: recipient?.displayName ?? null };
    } catch (error) {
      if (isUniqueViolation(error, "shares_owner_user_id_recipient_email_key")) {
        throw new HttpError(
          409,
          "conflict",
          "You already share your location with this address. Change that share instead.",
        );
      }
      throw error;
    }
  });

  ctx.logger.info({ shareId: created.row.id, ownerId: owner.id }, "share created");
  announceShareChange(ctx, {
    shareId: created.row.id,
    ownerId: owner.id,
    recipientId: created.row.recipientUserId,
    change: "created",
  });
  return toOutgoingShare(created.row, created.recipientName);
}
