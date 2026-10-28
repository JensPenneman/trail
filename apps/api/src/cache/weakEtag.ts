import { createHash } from "node:crypto";

/**
 * The weak validator of a conditional answer (docs/architecture.md §8.9):
 * `W/"` + the first 22 base64url characters of SHA-256 over the owner, the
 * route with its validated query, and what the answer is made of. The owner
 * is in it, so one account's ETag never matches another's answer, and the
 * route and query, so it never matches another question either. Weak: the
 * same data may go out as other bytes (compression, key order).
 */
export function weakEtag(ownerId: string, route: string, validator: unknown): string {
  const hash = createHash("sha256")
    .update(JSON.stringify([ownerId, route, validator]))
    .digest("base64url")
    .slice(0, 22);
  return `W/"${hash}"`;
}
