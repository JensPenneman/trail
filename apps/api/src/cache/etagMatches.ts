/** The entity tags of an `If-None-Match` list: `"…"` or `W/"…"`, whatever separates them. */
const entityTags = /(?:W\/)?"[^"]*"/g;

const opaque = (tag: string): string => (tag.startsWith("W/") ? tag.slice(2) : tag);

/**
 * Whether `If-None-Match` names `etag`, compared weakly (RFC 9110 §13.1.2): any
 * tag of the list with the same opaque part, `W/` or not, or `*`. A malformed
 * header names nothing. Express's own freshness check (`req.fresh`) agrees
 * wherever it matches, so a 200 this refuses is never turned into a 304 on
 * the way out.
 */
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (ifNoneMatch === undefined) return false;
  if (ifNoneMatch.trim() === "*") return true;
  const wanted = opaque(etag);
  for (const tag of ifNoneMatch.match(entityTags) ?? []) {
    if (opaque(tag) === wanted) return true;
  }
  return false;
}
