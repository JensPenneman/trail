import { randomBytes } from "node:crypto";

/** A URL-safe secret: `bytes` random bytes as base64url (32 bytes → 43 characters). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
