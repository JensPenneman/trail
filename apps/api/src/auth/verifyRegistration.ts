import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { Logger } from "pino";
import type { CeremonyRow } from "./ceremonies";
import { webauthnFailed } from "./webauthnFailed";
import { isRegistrationResponse } from "./webauthnResponseGuards";
import { supportedAlgorithmIDs } from "./webauthnSettings";

export type VerifiedRegistration = NonNullable<
  Awaited<ReturnType<typeof verifyRegistrationResponse>>["registrationInfo"]
>;

/**
 * Verifies an attestation against the ceremony it answers: same challenge,
 * same origin and RP ID, user verification performed. Any failure is 400
 * `webauthn_failed` (details only in the debug log).
 */
export async function verifyRegistration(
  ceremony: CeremonyRow,
  response: unknown,
  logger: Logger,
): Promise<VerifiedRegistration> {
  if (!isRegistrationResponse(response)) throw webauthnFailed("Expected a new passkey.");
  let result: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: ceremony.origin,
      expectedRPID: ceremony.rpId,
      requireUserVerification: true,
      supportedAlgorithmIDs,
    });
  } catch (error) {
    logger.debug({ err: error }, "passkey registration rejected");
    throw webauthnFailed();
  }
  if (!result.verified) throw webauthnFailed();
  return result.registrationInfo;
}
