/**
 * Paths whose next segment is a secret: the one-time tokens of /link/<token>,
 * /invite/<token> and /api/auth/link/<token>[/start], and the public share
 * links /s/<secret> and /api/public/shares/<secret>.
 */
const secretPrefixes: readonly (readonly string[])[] = [
  ["link"],
  ["invite"],
  ["api", "auth", "link"],
  ["s"],
  ["api", "public", "shares"],
];

/** Query parameters that carry a device token (docs/architecture.md §6). */
const tokenParameters = new Set(["token", "access_token"]);

/* API tokens belong in the Authorization header only; one that a client puts
 * into a URL anyway must not reach the log either, and neither does a share
 * link secret that turns up elsewhere in a URL. */
const apiTokenSecret = /trl[ks]_[A-Za-z0-9_-]{43}/;

const redacted = "[redacted]";

const decoded = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/**
 * A request URL fit for the logs: one-time link and invite tokens and share
 * link secrets in the path, device tokens in the query string and API token
 * and share link secrets anywhere become `[redacted]`. They are found the way the routers read them — decoded and
 * case-insensitive — so no spelling of the URL (`/LINK/…`, `?%74oken=…`)
 * carries a secret into the log.
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
  for (const [index, segment] of segments.entries()) {
    if (apiTokenSecret.test(decoded(segment))) segments[index] = redacted;
  }
  const query = [...parsed.searchParams].map(([name, value]) =>
    tokenParameters.has(name.toLowerCase()) || apiTokenSecret.test(value)
      ? `${encodeURIComponent(name)}=${redacted}`
      : `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
  );
  return `${segments.join("/")}${query.length === 0 ? "" : `?${query.join("&")}`}`;
}
