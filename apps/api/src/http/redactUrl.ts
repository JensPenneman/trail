/** Paths whose next segment is a one-time secret: /link/<token>, /invite/<token>, /api/auth/link/<token>[/start]. */
const secretPrefixes: readonly (readonly string[])[] = [
  ["link"],
  ["invite"],
  ["api", "auth", "link"],
];

/** Query parameters that carry a device token (docs/architecture.md §6). */
const tokenParameters = new Set(["token", "access_token"]);

const redacted = "[redacted]";

const decoded = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/**
 * A request URL fit for the logs: one-time link and invite tokens in the path
 * and device tokens in the query string become `[redacted]`. Both are found the
 * way the routers read them — decoded and case-insensitive — so no spelling of
 * the URL (`/LINK/…`, `?%74oken=…`) carries a secret into the log.
 */
export function redactUrl(url: string): string {
  const parsed = URL.parse(url, "http://trail.invalid");
  if (parsed === null) return redacted;
  const segments = parsed.pathname.split("/");
  const names = segments.map((segment) => decoded(segment).toLowerCase());
  for (const prefix of secretPrefixes) {
    const at = prefix.length + 1;
    const matches = prefix.every((part, index) => names[index + 1] === part);
    if (matches && (segments[at] ?? "") !== "") segments[at] = redacted;
  }
  const query = [...parsed.searchParams].map(([name, value]) =>
    tokenParameters.has(name.toLowerCase())
      ? `${encodeURIComponent(name)}=${redacted}`
      : `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
  );
  return `${segments.join("/")}${query.length === 0 ? "" : `?${query.join("&")}`}`;
}
