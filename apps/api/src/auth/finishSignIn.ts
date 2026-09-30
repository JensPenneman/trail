import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import type { AppContext } from "../appContext";
import { passkeys } from "../db/schema/passkeys";
import { users } from "../db/schema/users";
import { HttpError } from "../http/httpError";
import type { CeremonyRow } from "./ceremonies";
import type { UserRow } from "./requestAuth";
import { webauthnFailed } from "./webauthnFailed";
import { isAuthenticationResponse } from "./webauthnResponseGuards";

/**
 * Completes an `authenticate` ceremony. Targeted ceremonies (email first) only
 * accept the account's own passkeys; discoverable ones resolve the account from
 * the credential. A credential the server does not know is 401
 * `unknown_credential`, so the browser can be told to forget it.
 */
export async function finishSignIn(
  ctx: AppContext,
  ceremony: CeremonyRow,
  response: unknown,
): Promise<UserRow> {
  if (!isAuthenticationResponse(response)) throw webauthnFailed("Expected a passkey sign-in.");
  const [row] = await ctx.db
    .select({ passkey: passkeys, user: users })
    .from(passkeys)
    .innerJoin(users, eq(users.id, passkeys.userId))
    .where(eq(passkeys.id, response.id))
    .limit(1);
  if (row === undefined) {
    throw new HttpError(
      401,
      "unknown_credential",
      "This passkey is not registered here any more. Choose another passkey.",
    );
  }
  const { passkey, user } = row;
  if (ceremony.userId !== null && passkey.userId !== ceremony.userId) {
    throw webauthnFailed("This passkey belongs to another account.");
  }
  if (passkey.rpId !== ceremony.rpId) throw webauthnFailed();
  const { userHandle } = response.response;
  if (userHandle !== undefined && userHandle !== user.webauthnUserId.toString("base64url")) {
    throw webauthnFailed();
  }

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: ceremony.origin,
      expectedRPID: ceremony.rpId,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports,
      },
      requireUserVerification: true,
    });
  } catch (error) {
    ctx.logger.debug({ err: error }, "passkey sign-in rejected");
    throw webauthnFailed();
  }
  if (!verification.verified) throw webauthnFailed();

  const info = verification.authenticationInfo;
  await ctx.db
    .update(passkeys)
    .set({
      counter: info.newCounter,
      lastUsedAt: new Date(),
      backedUp: info.credentialBackedUp,
      deviceType: info.credentialDeviceType,
    })
    .where(eq(passkeys.id, passkey.id));
  return user;
}
