import {
  type PublicKeyCredentialRequestOptionsJSON,
  startAuthentication,
} from "@simplewebauthn/browser";
import type { FinishAuthResponse } from "@trail/contracts/auth";
import { finishAssertion } from "./finishAssertion";

/** Runs a passkey assertion in the browser's passkey sheet and completes it on the server. */
export async function assertAndFinish(
  ceremonyId: string,
  options: PublicKeyCredentialRequestOptionsJSON,
): Promise<FinishAuthResponse> {
  const response = await startAuthentication({ optionsJSON: options });
  return finishAssertion(ceremonyId, response);
}
