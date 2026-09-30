import { z } from "zod";
import { emailSchema } from "./email";
import { sessionUserSchema } from "./user";
import {
  authenticationResponseSchema,
  creationOptionsSchema,
  registrationResponseSchema,
  requestOptionsSchema,
} from "./webauthn";

/**
 * `POST /api/auth/start` — the single "Continue with email" step.
 * Existing account → `authenticate` (passkeys of this origin's RP ID in allowCredentials).
 * New address that may sign up (allow-list or valid invite) → `register`.
 */
export const startAuthRequestSchema = z.object({
  email: emailSchema,
  inviteToken: z.string().min(16).max(128).optional(),
});
export type StartAuthRequest = z.input<typeof startAuthRequestSchema>;

export const startAuthResponseSchema = z.discriminatedUnion("flow", [
  z.object({ flow: z.literal("register"), ceremonyId: z.uuid(), options: creationOptionsSchema }),
  z.object({
    flow: z.literal("authenticate"),
    ceremonyId: z.uuid(),
    options: requestOptionsSchema,
  }),
]);
export type StartAuthResponse = z.infer<typeof startAuthResponseSchema>;

/** `POST /api/auth/passkey` — usernameless options for conditional UI (autofill) or a "Use a passkey" button. */
export const passkeyOptionsResponseSchema = z.object({
  ceremonyId: z.uuid(),
  options: requestOptionsSchema,
});
export type PasskeyOptionsResponse = z.infer<typeof passkeyOptionsResponseSchema>;

/** `POST /api/auth/link/:token/start` — registration options to add a passkey through a one-time link. */
export const linkStartResponseSchema = z.object({
  ceremonyId: z.uuid(),
  options: creationOptionsSchema,
});
export type LinkStartResponse = z.infer<typeof linkStartResponseSchema>;

/**
 * `POST /api/auth/finish` — completes any ceremony started above. The server
 * knows from `ceremonyId` whether `response` is a registration or an assertion.
 * On success the session cookie is set.
 */
export const finishAuthRequestSchema = z.object({
  ceremonyId: z.uuid(),
  response: z.union([registrationResponseSchema, authenticationResponseSchema]),
});
export type FinishAuthRequest = z.input<typeof finishAuthRequestSchema>;

export const finishAuthResponseSchema = z.object({
  user: sessionUserSchema,
  /** True when this ceremony created the account. */
  created: z.boolean(),
});
export type FinishAuthResponse = z.infer<typeof finishAuthResponseSchema>;

/** `GET /api/auth/link/:token` — what a one-time link is for, before it is used. */
export const linkInfoResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("invite"),
    /** Set when the invite is bound to one address. */
    email: z.email().nullable(),
    expiresAt: z.iso.datetime(),
  }),
  z.object({
    kind: z.literal("passkey"),
    /** The account the new passkey will be added to. */
    email: z.email(),
    expiresAt: z.iso.datetime(),
  }),
]);
export type LinkInfoResponse = z.infer<typeof linkInfoResponseSchema>;
