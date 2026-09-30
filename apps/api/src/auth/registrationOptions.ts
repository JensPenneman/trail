import {
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/server";
import { ceremonyTtlMs, rpName, supportedAlgorithmIDs } from "./webauthnSettings";

export interface RegistrationSubject {
  rpId: string;
  email: string;
  displayName: string;
  /** The WebAuthn user handle (32 random bytes, never the user id). */
  webauthnUserId: Uint8Array<ArrayBuffer>;
  /** Passkeys the account already has on this RP ID, so the same authenticator is not added twice. */
  existing: ReadonlyArray<{ id: string; transports: string[] }>;
}

/** Options for `navigator.credentials.create`: a discoverable passkey with user verification. */
export function registrationOptions(
  subject: RegistrationSubject,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName,
    rpID: subject.rpId,
    userName: subject.email,
    userID: subject.webauthnUserId,
    userDisplayName: subject.displayName,
    timeout: ceremonyTtlMs,
    attestationType: "none",
    excludeCredentials: subject.existing.map(({ id, transports }) => ({ id, transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    supportedAlgorithmIDs,
  });
}
