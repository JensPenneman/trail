import { and, eq, gt, isNull } from "drizzle-orm";
import type { AppContext } from "../appContext";
import { passkeyLinks } from "../db/schema/passkeyLinks";
import { users } from "../db/schema/users";
import { HttpError } from "../http/httpError";
import { type CeremonyRow, ceremonyExpired } from "./ceremonies";
import type { UserRow } from "./requestAuth";
import { storePasskey } from "./storePasskey";
import { verifyRegistration } from "./verifyRegistration";

const linkInvalid = (): HttpError =>
  new HttpError(404, "link_invalid", "This link was already used or has expired.");

/** Completes a `link` ceremony: the link is used up and the new passkey added to its account. */
export async function finishLink(
  ctx: AppContext,
  ceremony: CeremonyRow,
  response: unknown,
): Promise<UserRow> {
  const { linkId, userId } = ceremony;
  if (linkId === null || userId === null) throw ceremonyExpired();
  const registration = await verifyRegistration(ceremony, response, ctx.logger);

  return ctx.db.transaction(async (tx) => {
    const now = new Date();
    const [link] = await tx
      .update(passkeyLinks)
      .set({ usedAt: now })
      .where(
        and(
          eq(passkeyLinks.id, linkId),
          eq(passkeyLinks.userId, userId),
          isNull(passkeyLinks.usedAt),
          gt(passkeyLinks.expiresAt, now),
        ),
      )
      .returning({ id: passkeyLinks.id });
    if (link === undefined) throw linkInvalid();
    await storePasskey(tx, { userId, rpId: ceremony.rpId, registration });
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (user === undefined) throw linkInvalid();
    return user;
  });
}
