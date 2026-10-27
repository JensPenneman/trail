/** Paths whose next segment is a one-time secret: /link/<token>, /invite/<token>, /api/auth/link/<token>[/start]. */
const secretPrefixes: readonly (readonly string[])[] = [
  ["link"],
  ["invite"],
  ["api", "auth", "link"],
];

/** Query parameters that carry a device token (docs/architecture.md §6). */
const tokenParameters = new Set(["token", "access_token"]);

/*
 * The endpoint whose query is a phone's upload: the OsmAnd format sends the
 * position (coordinates, which the logs never hold above debug) and Traccar
 * Client's device identifier, the token, as parameters. Every value goes, the
 * names stay — also below the endpoint and with doubled slashes, where a
 * mistyped template ends in a 404 at warn level.
 */
const payloadEndpoint = ["api", "osmand"];

/* A device token, an API token or a share link secret: API tokens belong in the
 * Authorization header and share link secrets in the X-Share-Secret header only;
 * one that a client puts into a URL anyway — a device token in an `id` — must
 * not reach the log either. */
const apiTokenSecret = /trl[ks]?_[A-Za-z0-9_-]{43}/;

const redacted = "[redacted]";

const decoded = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/* `/api/osmand`, `/API/OSMAND/`, `/api//osmand/x`: the decoded, lower-cased path's first two names. */
const isPayloadPath = (names: readonly string[]): boolean => {
  const parts = names.filter((name) => name !== "");
  return payloadEndpoint.every((part, index) => parts[index] === part);
};

/**
 * A request URL fit for the logs: one-time link and invite tokens in the path,
 * device tokens in the query string, every value of an upload in the OsmAnd
 * format, and device tokens, API tokens and share link secrets anywhere become
 * `[redacted]`. They are found the way the routers read them — decoded and
 * case-insensitive — so no spelling of the URL (`/LINK/…`, `?%74oken=…`)
 * carries a secret into the log.
 */
export function redactUrl(url: string): string {
  // A path (`//api/osmand?…` too) is a path, never a host: the request line has no host in it.
  const parsed = url.startsWith("/")
    ? URL.parse(`http://trail.invalid${url}`)
    : URL.parse(url, "http://trail.invalid");
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
  const payload = isPayloadPath(names);
  const query = [...parsed.searchParams].map(([name, value]) => {
    // A secret can also arrive as a parameter's name (`?trls_…`): then the name goes too.
    const shownName = apiTokenSecret.test(name) ? redacted : encodeURIComponent(name);
    return payload || tokenParameters.has(name.toLowerCase()) || apiTokenSecret.test(value)
      ? `${shownName}=${redacted}`
      : `${shownName}=${encodeURIComponent(value)}`;
  });
  return `${segments.join("/")}${query.length === 0 ? "" : `?${query.join("&")}`}`;
}
