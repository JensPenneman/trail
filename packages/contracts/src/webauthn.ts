import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import { z } from "zod";

/* WebAuthn JSON shapes are produced and verified by SimpleWebAuthn on both
 * ends; the contract only checks the envelope and carries the library types. */
const isObject = (value: unknown): boolean => typeof value === "object" && value !== null;

export const creationOptionsSchema = z.custom<PublicKeyCredentialCreationOptionsJSON>(isObject);
export const requestOptionsSchema = z.custom<PublicKeyCredentialRequestOptionsJSON>(isObject);
export const registrationResponseSchema = z.custom<RegistrationResponseJSON>(
  (value) => isObject(value) && typeof (value as { id?: unknown }).id === "string",
);
export const authenticationResponseSchema = z.custom<AuthenticationResponseJSON>(
  (value) => isObject(value) && typeof (value as { id?: unknown }).id === "string",
);
