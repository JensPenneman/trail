import {
  generateAuthenticationOptions,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import { ceremonyTtlMs } from "./webauthnSettings";

/**
 * Options for `navigator.credentials.get`. An empty `allowCredentials` makes it
 * discoverable (conditional UI / "Use a passkey"); otherwise only the listed
 * passkeys of this RP ID are offered.
 */
export function authenticationOptions(input: {
  rpId: string;
  allowCredentials: ReadonlyArray<{ id: string; transports: string[] }>;
}): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: input.rpId,
    allowCredentials: input.allowCredentials.map(({ id, transports }) => ({ id, transports })),
    timeout: ceremonyTtlMs,
    userVerification: "required",
  });
}
