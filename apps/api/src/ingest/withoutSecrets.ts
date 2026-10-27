/** A device token, an API token or a share link secret anywhere in a text. */
const secretPattern = /trl[ks]?_[A-Za-z0-9_-]{43}/g;

/*
 * Keys that hold a credential in what the apps send: OwnTracks' configuration
 * dump has the password (Trail's device token) and the encryption key, the
 * OsmAnd format's `id` and `token` are the device token.
 */
const secretKeys = new Set([
  "password",
  "pass",
  "secret",
  "encryptionkey",
  "token",
  "access_token",
  "authorization",
]);

/** Deeper than anything an app sends; `storableJson` cuts there as well. */
const maxDepth = 16;

/**
 * A text with every token-shaped part replaced. Before any cut: a token cut in
 * half no longer has the shape, and would stay.
 */
export function redactSecrets(text: string): string {
  return text.replace(secretPattern, "[redacted]");
}

/**
 * A record as Trail may keep it (`extra`, the dead letter): without keys that
 * hold a credential, and with every token-shaped text replaced — whatever a
 * phone sent, its token never lands in the database or a log.
 */
export function withoutSecrets(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (typeof value !== "object" || value === null) return value;
  if (depth >= maxDepth) return null;
  if (Array.isArray(value)) return value.map((item: unknown) => withoutSecrets(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !secretKeys.has(key.toLowerCase()))
      .map(([key, item]) => [redactSecrets(key), withoutSecrets(item, depth + 1)]),
  );
}
