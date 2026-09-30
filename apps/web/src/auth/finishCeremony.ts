import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/browser";
import { apiPaths } from "@trail/contracts/apiPaths";
import { type FinishAuthResponse, finishAuthResponseSchema } from "@trail/contracts/auth";
import { apiFetch } from "../api/apiFetch";

/** Hands the browser's passkey response to the server, which sets the session cookie on success. */
export function finishCeremony(
  ceremonyId: string,
  response: RegistrationResponseJSON | AuthenticationResponseJSON,
): Promise<FinishAuthResponse> {
  return apiFetch(apiPaths.auth.finish, finishAuthResponseSchema, {
    body: { ceremonyId, response },
  });
}
