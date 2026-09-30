import { and, count, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { AppContext } from "../appContext";
import { isUniqueViolation } from "../db/isUniqueViolation";
import { invites } from "../db/schema/invites";
import { users } from "../db/schema/users";
import { HttpError } from "../http/httpError";
import { type CeremonyRow, ceremonyExpired } from "./ceremonies";
import { isSignupAllowlisted } from "./isSignupAllowlisted";
import type { UserRow } from "./requestAuth";
import { storePasskey } from "./storePasskey";
import { verifyRegistration } from "./verifyRegistration";

/** Serialises sign-ups so that "the first account ever created is admin" holds under concurrency. */
const signupLockKey = 740_318_267;

const localPart = (email: string): string => email.slice(0, email.lastIndexOf("@"));

/**
 * Completes a `register` ceremony: creates the user (admin when first), stores
 * the passkey and consumes the invite, all in one transaction. The sign-up
 * policy is checked again because an invite can be used up meanwhile.
 */
export async function finishSignUp(
  ctx: AppContext,
  ceremony: CeremonyRow,
  response: unknown,
): Promise<UserRow> {
  const { email, webauthnUserId, inviteId } = ceremony;
  if (email === null || webauthnUserId === null) throw ceremonyExpired();
  const registration = await verifyRegistration(ceremony, response, ctx.logger);

  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${signupLockKey})`);
    const now = new Date();
    let usedInviteId: string | null = null;
    if (inviteId !== null) {
      const [invite] = await tx
        .update(invites)
        .set({ usedAt: now })
        .where(
          and(
            eq(invites.id, inviteId),
            isNull(invites.usedAt),
            gt(invites.expiresAt, now),
            or(isNull(invites.email), eq(invites.email, email)),
          ),
        )
        .returning({ id: invites.id });
      usedInviteId = invite?.id ?? null;
    }
    if (usedInviteId === null && !isSignupAllowlisted(email, ctx.config.signupAllowlist)) {
      throw new HttpError(
        403,
        "signup_not_allowed",
        "This invite is no longer valid. Ask for a new one.",
      );
    }

    const [existing] = await tx.select({ total: count() }).from(users);
    let user: UserRow | undefined;
    try {
      [user] = await tx
        .insert(users)
        .values({
          email,
          displayName: localPart(email),
          webauthnUserId,
          isAdmin: (existing?.total ?? 0) === 0,
          timezone: ctx.config.defaultTimezone,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, "users_email_key")) {
        throw new HttpError(
          409,
          "conflict",
          "An account with this address already exists. Sign in instead.",
        );
      }
      throw error;
    }
    if (user === undefined) throw new Error("Creating the user returned no row");

    if (usedInviteId !== null) {
      await tx.update(invites).set({ usedBy: user.id }).where(eq(invites.id, usedInviteId));
    }
    await storePasskey(tx, { userId: user.id, rpId: ceremony.rpId, registration });
    return user;
  });
}
