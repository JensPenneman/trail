import {
  historyNeedsPrecise,
  type OutgoingShare,
  type updateShareRequestSchema,
} from "@trail/contracts/share";
import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import type { AppContext } from "../appContext";
import type { RequestAuth } from "../auth/requestAuth";
import { shares } from "../db/schema/shares";
import { HttpError, notFound } from "../http/httpError";
import { announceShareChange } from "./announceShareChange";
import { findOutgoingShare, toOutgoingShare } from "./outgoingShares";
import { assertOwnDevices, assertTokenMayShare } from "./shareableDevices";
import { shareExpiresAt } from "./shareExpiry";

type UpdateShare = z.output<typeof updateShareRequestSchema>;

/**
 * Changes a current share: a new duration counts from now; the other fields
 * change only when given. The result must still keep history to precise
 * shares. The recipient sees the change with their next look.
 */
export async function changeShare(
  ctx: AppContext,
  auth: RequestAuth,
  shareId: string,
  changes: UpdateShare,
): Promise<OutgoingShare> {
  const now = new Date();
  const { share: current, recipientName } = await findOutgoingShare(
    ctx.db,
    auth.user.id,
    shareId,
    now,
  );
  const next = {
    deviceIds: changes.deviceIds === undefined ? current.deviceIds : changes.deviceIds,
    precision: changes.precision ?? current.precision,
    historyDays: changes.historyDays === undefined ? current.historyDays : changes.historyDays,
    includeDetails: changes.includeDetails ?? current.includeDetails,
    expiresAt:
      changes.duration === undefined
        ? current.expiresAt
        : shareExpiresAt(changes.duration, now, auth.user.timezone),
  };
  if (next.historyDays !== null && next.precision !== "precise") {
    throw new HttpError(400, "validation_failed", historyNeedsPrecise, {
      historyDays: [historyNeedsPrecise],
    });
  }
  assertTokenMayShare(auth, next.deviceIds);
  if (changes.deviceIds !== undefined) await assertOwnDevices(ctx.db, auth, changes.deviceIds);

  const [row] = await ctx.db
    .update(shares)
    .set(next)
    .where(
      and(
        eq(shares.id, current.id),
        eq(shares.ownerUserId, auth.user.id),
        isNull(shares.revokedAt),
      ),
    )
    .returning();
  if (row === undefined) throw notFound("No such share.");
  announceShareChange(ctx, {
    shareId: row.id,
    ownerId: row.ownerUserId,
    recipientId: row.recipientUserId,
    change: "updated",
  });
  return toOutgoingShare(row, recipientName);
}
