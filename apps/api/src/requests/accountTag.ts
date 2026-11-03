import { createHmac, randomBytes } from "node:crypto";

/**
 * An opaque tag for the account behind a request, for the request log: an
 * HMAC of its id under a key this process draws at its start and never
 * keeps. Within one process the tag groups an account's requests ("one
 * account makes the slow ones"); it cannot be turned back into the id, not
 * even with the database, and the next start gives every account another.
 */
export function accountTagger(): (userId: string) => string {
  const key = randomBytes(32);
  return (userId) => createHmac("sha256", key).update(userId).digest("base64url").slice(0, 12);
}
