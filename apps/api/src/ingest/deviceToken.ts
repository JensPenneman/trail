/** A device token: `trl_` and 32 random bytes in base64url (`generateDeviceToken`). */
const tokenPattern = /^trl_[A-Za-z0-9_-]{43}$/;

/** Whether a value has the shape of a device token; anything else costs no database lookup. */
export function isDeviceToken(value: unknown): value is string {
  return typeof value === "string" && tokenPattern.test(value);
}

/** The scheme of an `Authorization` header, in lower case, or null without one. */
export function authorizationScheme(header: string | undefined): string | null {
  if (header === undefined) return null;
  return /^\s*([A-Za-z][A-Za-z0-9!#$%&'*+.^_`|~-]*)/.exec(header)?.[1]?.toLowerCase() ?? null;
}

/** The value of `Authorization: Bearer <value>` (any letter case), or null. */
export function bearerCredential(header: string | undefined): string | null {
  if (header === undefined) return null;
  return /^\s*Bearer\s+(\S+)\s*$/i.exec(header)?.[1] ?? null;
}

/**
 * The password of `Authorization: Basic <base64 user:password>`, or null: the
 * user name is anything the app has, the password is the device token.
 */
export function basicPassword(header: string | undefined): string | null {
  if (header === undefined) return null;
  const encoded = /^\s*Basic\s+([A-Za-z0-9+/]+={0,2})\s*$/i.exec(header)?.[1];
  if (encoded === undefined) return null;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon < 0 ? null : decoded.slice(colon + 1);
}
