import { createHmac, randomBytes } from "node:crypto";

const maxCachedTags = 1024;

/**
 * An opaque tag for the account behind a request, for the request log: an
 * HMAC of its id under a key this process draws at its start and never
 * keeps. Within one process the tag groups an account's requests ("one
 * account makes the slow ones"); it cannot be turned back into the id, not
 * even with the database, and the next start gives every account another.
 */
export function accountTagger(): (userId: string) => string {
  const key = randomBytes(32);
  // Every request of a signed-in account asks for its tag: remember the recent ones.
  const tags = new Map<string, string>();
  return (userId) => {
    let tag = tags.get(userId);
    if (tag === undefined) {
      tag = createHmac("sha256", key).update(userId).digest("base64url").slice(0, 12);
      if (tags.size >= maxCachedTags) tags.clear();
      tags.set(userId, tag);
    }
    return tag;
  };
}
