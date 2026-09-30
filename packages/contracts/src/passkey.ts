import { z } from "zod";
import { creationOptionsSchema, registrationResponseSchema } from "./webauthn";

export const passkeySchema = z.object({
  /** Credential ID (base64url). */
  id: z.string(),
  /** User-editable label; defaults to the provider name (e.g. "iCloud Keychain"). */
  name: z.string(),
  /** Relying-party ID (hostname) the passkey is bound to. */
  rpId: z.string(),
  /** True when `rpId` is the RP ID of the origin making the request. */
  usableHere: z.boolean(),
  /** Provider resolved from the AAGUID, or null when unknown. */
  provider: z.string().nullable(),
  /** Synced (multi-device) passkey vs device-bound key. */
  backedUp: z.boolean(),
  deviceType: z.enum(["singleDevice", "multiDevice"]),
  transports: z.array(z.string()),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type Passkey = z.infer<typeof passkeySchema>;

export const passkeyListResponseSchema = z.object({ passkeys: z.array(passkeySchema) });
export type PasskeyListResponse = z.infer<typeof passkeyListResponseSchema>;

/** `POST /api/me/passkeys/options` → registration options (excludeCredentials = existing passkeys). */
export const addPasskeyOptionsResponseSchema = z.object({
  ceremonyId: z.uuid(),
  options: creationOptionsSchema,
});
export type AddPasskeyOptionsResponse = z.infer<typeof addPasskeyOptionsResponseSchema>;

/** `POST /api/me/passkeys` */
export const addPasskeyRequestSchema = z.object({
  ceremonyId: z.uuid(),
  response: registrationResponseSchema,
  name: z.string().trim().min(1).max(60).optional(),
});
export type AddPasskeyRequest = z.input<typeof addPasskeyRequestSchema>;

export const addPasskeyResponseSchema = z.object({ passkey: passkeySchema });
export type AddPasskeyResponse = z.infer<typeof addPasskeyResponseSchema>;

/** `PATCH /api/me/passkeys/:id` */
export const renamePasskeyRequestSchema = z.object({ name: z.string().trim().min(1).max(60) });
export type RenamePasskeyRequest = z.input<typeof renamePasskeyRequestSchema>;
