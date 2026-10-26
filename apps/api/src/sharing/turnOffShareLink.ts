import { and, eq, isNull } from "drizzle-orm";
import type { AppContext } from "../appContext";
import type { RequestAuth } from "../auth/requestAuth";
import { shareLinks } from "../db/schema/shareLinks";
import { notFound } from "../http/httpError";
import { isUuid } from "../lib/isUuid";

/** Turns a link off at once: its page answers that it ended from the next request on. */
export async function turnOffShareLink(
  ctx: AppContext,
  auth: RequestAuth,
  linkId: string,
): Promise<void> {
  if (!isUuid(linkId)) throw notFound("No such link.");
  const [row] = await ctx.db
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(shareLinks.id, linkId),
        eq(shareLinks.ownerUserId, auth.user.id),
        isNull(shareLinks.revokedAt),
      ),
    )
    .returning({ id: shareLinks.id });
  if (row === undefined) throw notFound("No such link.");
  ctx.sharing.forgetLink(row.id);
  ctx.logger.info({ linkId: row.id, ownerId: auth.user.id }, "share link turned off");
}
