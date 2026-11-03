/** Paths whose next segment is a one-time secret: /link/<token>, /invite/<token>, /api/auth/link/<token>[/start]. */
const secretPrefixes: readonly (readonly string[])[] = [
  ["link"],
  ["invite"],
  ["api", "auth", "link"],
];

/* A device token, an API token or a share link secret: API tokens belong in the
 * Authorization header and share link secrets in the X-Share-Secret header only;
 * one that a client puts into a URL anyway — a device token in an `id` — must
 * not reach the log either. */
const apiTokenSecret = /trl[ks]?_[A-Za-z0-9_-]{43}/;

const redacted = "[redacted]";

/* A basemap tile's path: its zoom, column and row are where someone looks on the map. */
const tilePrefix = ["map", "tiles"];

/* A parameter name fit to log: an identifier, not a client's whole query (`?lat%3D51.05%26lon%3D3.71`
 * or `?51.05,3.71` is a name that carries values). */
const loggableName = /^[A-Za-z_][\w.[\]-]{0,63}$/;

const decoded = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/**
 * A request URL fit for the logs: the path, with one-time link and invite
 * tokens, device tokens, API tokens and share link secrets in it as
 * `[redacted]`, a basemap tile's zoom, column and row (where someone looks),
 * and the query's parameter names only, never a value
 * (`/api/v1/tracks?bbox&from&to`) — a value is a coordinate, a time, a token.
 * A name that is no identifier (a value in disguise) or carries a secret goes
 * too, and so does a path segment that holds `=`, `;` or `?` once decoded. Secrets are found the way the routers read
 * them — decoded and case-insensitive — so no spelling of the URL (`/LINK/…`)
 * carries one into the log.
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
    const text = decoded(segment);
    // `;lat=51.05` or an encoded `?lat=…` in a segment is a query in disguise (a mistyped template).
    if (apiTokenSecret.test(text) || /[=;?]/.test(text)) segments[index] = redacted;
  }
  if (tilePrefix.every((part, index) => names[index + 1] === part) && segments.length > 4) {
    // `/map/tiles/<bundle>/[redacted]`: the bundle stays, the tile goes.
    segments.splice(4, segments.length - 4, redacted);
  }
  const query = [...parsed.searchParams.keys()].map((name) =>
    // A secret can also arrive as a parameter's name (`?trls_…`): then the name goes too.
    apiTokenSecret.test(name) || !loggableName.test(name) ? redacted : name,
  );
  return `${segments.join("/")}${query.length === 0 ? "" : `?${query.join("&")}`}`;
}
