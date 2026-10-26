import { apiPaths } from "@trail/contracts/apiPaths";
import {
  type CreateShareLinkResponse,
  type createShareLinkRequestSchema,
  defaultShareLinkHours,
  maxShareLinkDays,
  minShareLinkHours,
} from "@trail/contracts/shareLink";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import type { AppContext } from "../appContext";
import type { RequestAuth } from "../auth/requestAuth";
import { shareLinks } from "../db/schema/shareLinks";
import { HttpError } from "../http/httpError";
import { assertShareableDevices } from "./shareableDevices";
import { maxCurrentShareLinks } from "./shareLimits";
import { newShareLinkSecret } from "./shareLinkSecret";
import { toShareLink } from "./toShareLink";

type CreateShareLink = z.output<typeof createShareLinkRequestSchema>;

/** A request's clock and ours differ a little: an expiry a minute past a limit still counts. */
const slackMs = 60_000;

/** What visitors see when the owner gives no label: nothing of the account. */
const defaultShareLinkLabel = "Shared location";

/**
 * Makes a public link (docs/architecture.md §8.4). Its secret and URL are in
 * this answer only; the database keeps the SHA-256 of the secret. A link
 * always expires: in 24 hours unless asked otherwise, in an hour at the
 * soonest and 30 days at the latest. At most `maxCurrentShareLinks` work at
 * the same time. Without a label it is "Shared location", never a name.
 */
export async function makeShareLink(
  ctx: AppContext,
  auth: RequestAuth,
  request: CreateShareLink,
): Promise<CreateShareLinkResponse> {
  const deviceIds = request.deviceIds ?? null;
  await assertShareableDevices(ctx.db, auth, deviceIds);
  const now = new Date();
  const expiresAt =
    request.expiresAt === undefined
      ? new Date(now.getTime() + defaultShareLinkHours * 3_600_000)
      : new Date(request.expiresAt);
  if (
    expiresAt.getTime() < now.getTime() + minShareLinkHours * 3_600_000 - slackMs ||
    expiresAt.getTime() > now.getTime() + maxShareLinkDays * 86_400_000 + slackMs
  ) {
    throw new HttpError(
      400,
      "validation_failed",
      `A link runs at least ${minShareLinkHours} hour and at most ${maxShareLinkDays} days.`,
      { expiresAt: [`Pick a time between an hour and ${maxShareLinkDays} days from now`] },
    );
  }
  const { secret, hash } = newShareLinkSecret();

  const row = await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM users WHERE id = ${auth.user.id} FOR UPDATE`);
    const [current] = await tx
      .select({ total: count() })
      .from(shareLinks)
      .where(
        and(
          eq(shareLinks.ownerUserId, auth.user.id),
          isNull(shareLinks.revokedAt),
          gt(shareLinks.expiresAt, now),
        ),
      );
    if ((current?.total ?? 0) >= maxCurrentShareLinks) {
      throw new HttpError(
        409,
        "conflict",
        `${maxCurrentShareLinks} links already work. Turn one off first.`,
      );
    }
    const [inserted] = await tx
      .insert(shareLinks)
      .values({
        ownerUserId: auth.user.id,
        tokenHash: hash,
        label: request.label ?? defaultShareLinkLabel,
        deviceIds,
        precision: request.precision,
        historyDays: request.historyDays ?? null,
        includeDetails: request.includeDetails ?? false,
        expiresAt,
        createdAt: now,
      })
      .returning();
    if (inserted === undefined) throw new Error("Storing the link returned no row");
    return inserted;
  });

  ctx.logger.info({ linkId: row.id, ownerId: auth.user.id }, "share link created");
  return {
    link: toShareLink(row, now),
    secret,
    url: `${ctx.config.publicUrl}${apiPaths.sharePage.link(secret)}`,
  };
}
