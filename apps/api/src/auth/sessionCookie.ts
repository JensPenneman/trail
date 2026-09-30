import { parseCookie, stringifySetCookie } from "cookie";
import type { Request } from "express";

/* `__Host-` makes the browser insist on Secure, Path=/ and no Domain, so a
 * sibling subdomain or a plain-HTTP page cannot plant a session cookie. It only
 * works over HTTPS; plain-HTTP localhost uses the unprefixed name. */
export const secureSessionCookieName = "__Host-trail_session";
export const plainSessionCookieName = "trail_session";

export const sessionCookieName = (secure: boolean): string =>
  secure ? secureSessionCookieName : plainSessionCookieName;

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

/** `Set-Cookie` value carrying a session token for `maxAgeSeconds`. */
export function sessionCookie(token: string, secure: boolean, maxAgeSeconds: number): string {
  return stringifySetCookie({
    name: sessionCookieName(secure),
    value: token,
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

/** `Set-Cookie` value that removes the session cookie. */
export function clearedSessionCookie(secure: boolean): string {
  return stringifySetCookie({
    name: sessionCookieName(secure),
    value: "",
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

/** The session token from the cookie matching the request's scheme, if well-formed. */
export function readSessionToken(req: Request): string | null {
  const header = req.headers.cookie;
  if (header === undefined) return null;
  const token = parseCookie(header)[sessionCookieName(req.secure)];
  return token !== undefined && tokenPattern.test(token) ? token : null;
}
