import { hashToken } from "../lib/hashToken";
import { randomToken } from "../lib/randomToken";

export interface ApiTokenValue {
  /** The secret: shown exactly once, when the token is created or rolled. */
  token: string;
  hash: string;
  /** Last four characters, to tell tokens apart in the list. */
  hint: string;
}

/**
 * A new API token secret: `trlk_` + 32 random bytes base64url; only its SHA-256
 * is stored. A fast hash is enough for a random 256-bit value (no salt or slow
 * KDF, unlike a password), and it allows the indexed lookup.
 */
export function randomApiToken(): ApiTokenValue {
  const token = `trlk_${randomToken(32)}`;
  return { token, hash: hashToken(token), hint: token.slice(-4) };
}
