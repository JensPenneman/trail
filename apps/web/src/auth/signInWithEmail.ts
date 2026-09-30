import { startRegistration } from "@simplewebauthn/browser";
import { apiPaths } from "@trail/contracts/apiPaths";
import { type FinishAuthResponse, startAuthResponseSchema } from "@trail/contracts/auth";
import { apiFetch } from "../api/apiFetch";
import { assertAndFinish } from "./assertAndFinish";
import { finishCeremony } from "./finishCeremony";

/**
 * The unified "Continue" step: the server decides whether this address signs
 * in (existing account) or signs up (allow-listed or invited), and the browser
 * runs the matching passkey ceremony.
 */
export async function signInWithEmail(
  email: string,
  inviteToken?: string,
): Promise<FinishAuthResponse> {
  const start = await apiFetch(apiPaths.auth.start, startAuthResponseSchema, {
    body: inviteToken === undefined ? { email } : { email, inviteToken },
  });
  if (start.flow === "register") {
    const response = await startRegistration({ optionsJSON: start.options });
    return finishCeremony(start.ceremonyId, response);
  }
  return assertAndFinish(start.ceremonyId, start.options);
}
