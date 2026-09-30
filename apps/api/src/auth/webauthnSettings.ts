import { COSEALG } from "@simplewebauthn/server/helpers";

/** Relying-party name shown by password managers. */
export const rpName = "Trail";

/**
 * Ed25519, ES256 and RS256 — what every authenticator supports. SimpleWebAuthn
 * would add ML-DSA-44 on Node versions where it is still experimental.
 */
export const supportedAlgorithmIDs: number[] = [COSEALG.EdDSA, COSEALG.ES256, COSEALG.RS256];

/** Ceremonies are single use and expire after five minutes (docs/architecture.md §7). */
export const ceremonyTtlMs = 5 * 60_000;
