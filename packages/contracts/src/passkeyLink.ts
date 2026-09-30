import { z } from "zod";

/**
 * `POST /api/me/passkey-links` — a one-time link (15 min) that lets the signed-in
 * user add a passkey on another device or on another allowed origin (each
 * hostname is its own WebAuthn RP ID). The CLI prints the same kind of link for
 * account recovery.
 */
export const createPasskeyLinkRequestSchema = z.object({
  /** One of the server's allowed origins; defaults to the public URL. */
  origin: z.url().optional(),
});
export type CreatePasskeyLinkRequest = z.input<typeof createPasskeyLinkRequestSchema>;

export const createPasskeyLinkResponseSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type CreatePasskeyLinkResponse = z.infer<typeof createPasskeyLinkResponseSchema>;
