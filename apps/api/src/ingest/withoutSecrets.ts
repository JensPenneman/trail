import { storableText } from "./storableText";

/** A device token, an API token or a share link secret anywhere in a text. */
const secretPattern = /trl[ks]?_[A-Za-z0-9_-]{43}/g;

/*
 * Keys that hold a credential in what the apps send, compared in lower case
 * without separators (`access_token`, `accessToken` and `access-token` alike):
 * OwnTracks' configuration dump has the password (Trail's device token) and
 * the encryption key, the OsmAnd format's `token` is the device token, and
 * OsmAnd's own `{13}` placeholder is OsmAnd Cloud's `accessToken`. Not `id`:
 * OwnTracks' `_id` and others are no credential; the OsmAnd format's `id` and
 * `deviceid` are left out of its parameters (`storableParameters`).
 */
const secretKeys = new Set([
  "password",
  "passwd",
  "pass",
  "secret",
  "encryptionkey",
  "token",
  "accesstoken",
  "authorization",
  "apikey",
]);

const isSecretKey = (key: string): boolean =>
  secretKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""));

/** Deeper than anything an app sends; `storableJson` cuts there as well. */
const maxDepth = 16;

/**
 * A text with every token-shaped part replaced. The pattern is matched on the
 * text as it will be stored — a NUL inside a token would hide it, and storing
 * drops NULs — and a text without a token comes back unchanged, for the
 * normalisers to judge as it arrived. Before any cut: a token cut in half no
 * longer has the shape, and would stay.
 */
export function redactSecrets(text: string): string {
  const storable = storableText(text);
  const redacted = storable.replace(secretPattern, "[redacted]");
  return redacted === storable ? text : redacted;
}

/**
 * A record as Trail may keep it — in columns, `extra` or the dead letter —
 * without keys that hold a credential, and with every token-shaped text
 * replaced: whatever a phone sent, its token never lands in the database or a
 * log. The ingest endpoints apply it to what arrived before anything reads it.
 */
export function withoutSecrets(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (typeof value !== "object" || value === null) return value;
  if (depth >= maxDepth) return null;
  if (Array.isArray(value)) return value.map((item: unknown) => withoutSecrets(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isSecretKey(key))
      .map(([key, item]) => [redactSecrets(key), withoutSecrets(item, depth + 1)]),
  );
}
