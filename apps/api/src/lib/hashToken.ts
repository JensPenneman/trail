import { createHash } from "node:crypto";

/**
 * SHA-256 hex of a secret token. Tokens are high-entropy random values, so a
 * plain hash (no salt, no slow KDF) is enough and allows indexed lookups.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
