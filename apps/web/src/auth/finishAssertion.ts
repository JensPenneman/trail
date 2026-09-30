import type { AuthenticationResponseJSON } from "@simplewebauthn/browser";
import type { FinishAuthResponse } from "@trail/contracts/auth";
import { ApiError } from "../api/ApiError";
import { finishCeremony } from "./finishCeremony";
import { forgetUnknownCredential } from "./forgetUnknownCredential";

/**
 * Completes a passkey assertion on the server. When the server no longer
 * knows the credential, the browser is asked to forget it before the error
 * goes on to the caller.
 */
export async function finishAssertion(
  ceremonyId: string,
  response: AuthenticationResponseJSON,
): Promise<FinishAuthResponse> {
  try {
    return await finishCeremony(ceremonyId, response);
  } catch (error) {
    if (error instanceof ApiError && error.code === "unknown_credential") {
      await forgetUnknownCredential(response.id);
    }
    throw error;
  }
}
