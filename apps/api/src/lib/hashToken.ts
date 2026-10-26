import { createHash } from "node:crypto";

/**
 * SHA-256 hex of a secret token. Tokens are high-entropy random values, so a
 * plain hash (no salt, no slow KDF) is enough and allows indexed lookups.
 */
export function hashToken(token: string): string {
  // Not a password hash: 256 random bits cannot be guessed, so a slow KDF would only slow every request.
  return createHash("sha256").update(token, "utf8").digest("hex");
}
