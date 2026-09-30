import { normaliseOrigin } from "../config/normaliseOrigin";

/** Where a WebAuthn ceremony runs: the page origin and its RP ID (the hostname). */
export interface CeremonyOrigin {
  origin: string;
  rpId: string;
}

/** RP ID of an origin: its hostname, so `localhost` and the public domain hold separate passkeys. */
export const rpIdOf = (origin: string): string => new URL(origin).hostname;

/**
 * The ceremony origin for a request's `Origin` header, or null when the header
 * is missing or not one of the allowed origins (PUBLIC_URL + ADDITIONAL_ORIGINS).
 */
export function ceremonyOriginFor(
  originHeader: string | undefined,
  allowedOrigins: readonly string[],
): CeremonyOrigin | null {
  if (originHeader === undefined) return null;
  const origin = normaliseOrigin(originHeader);
  if (origin === null || !allowedOrigins.includes(origin)) return null;
  return { origin, rpId: rpIdOf(origin) };
}
