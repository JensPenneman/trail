/**
 * `scheme://host[:port]` of an http(s) URL that has no path, query or fragment,
 * or null for anything else. Used for PUBLIC_URL, ADDITIONAL_ORIGINS and Origin headers.
 */
export function normaliseOrigin(value: string): string | null {
  const url = URL.parse(value.trim());
  if (url === null) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return null;
  if (url.username !== "" || url.password !== "") return null;
  return url.origin;
}
