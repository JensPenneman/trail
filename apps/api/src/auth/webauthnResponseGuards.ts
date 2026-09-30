import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasCredentialEnvelope = (value: Record<string, unknown>): boolean =>
  typeof value["id"] === "string" &&
  typeof value["rawId"] === "string" &&
  value["type"] === "public-key" &&
  isObject(value["response"]);

/* The contract only checks the envelope; these guards make sure the response
 * kind matches the ceremony before SimpleWebAuthn parses it. */

export function isRegistrationResponse(value: unknown): value is RegistrationResponseJSON {
  if (!isObject(value) || !hasCredentialEnvelope(value)) return false;
  const response = value["response"];
  return (
    isObject(response) &&
    typeof response["clientDataJSON"] === "string" &&
    typeof response["attestationObject"] === "string"
  );
}

export function isAuthenticationResponse(value: unknown): value is AuthenticationResponseJSON {
  if (!isObject(value) || !hasCredentialEnvelope(value)) return false;
  const response = value["response"];
  return (
    isObject(response) &&
    typeof response["clientDataJSON"] === "string" &&
    typeof response["authenticatorData"] === "string" &&
    typeof response["signature"] === "string" &&
    (response["userHandle"] === undefined || typeof response["userHandle"] === "string")
  );
}
