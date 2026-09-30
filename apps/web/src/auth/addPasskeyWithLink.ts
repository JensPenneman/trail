import { startRegistration } from "@simplewebauthn/browser";
import { apiPaths } from "@trail/contracts/apiPaths";
import { type FinishAuthResponse, linkStartResponseSchema } from "@trail/contracts/auth";
import { apiFetch } from "../api/apiFetch";
import { finishCeremony } from "./finishCeremony";

/** Creates a passkey for the account a one-time link belongs to; finishing it signs in. */
export async function addPasskeyWithLink(token: string): Promise<FinishAuthResponse> {
  const { ceremonyId, options } = await apiFetch(
    apiPaths.auth.linkStart(token),
    linkStartResponseSchema,
    { method: "POST" },
  );
  const response = await startRegistration({ optionsJSON: options });
  return finishCeremony(ceremonyId, response);
}
