import type { ApiScope } from "@trail/contracts/apiScope";
import type { Request } from "express";
import type { users } from "../db/schema/users";
import { HttpError } from "../http/httpError";

export type UserRow = typeof users.$inferSelect;

/** A browser signed in with a passkey: the session cookie (docs/architecture.md §7). */
export interface SessionPrincipal {
  kind: "session";
  user: UserRow;
  sessionId: string;
}

/**
 * An API token (`Authorization: Bearer trlk_…`), accepted on `/api/v1` only. It
 * may do what its scopes allow, with the devices it names.
 */
export interface TokenPrincipal {
  kind: "token";
  user: UserRow;
  tokenId: string;
  /** The name its owner gave it: what the data access log calls it. */
  tokenName: string;
  scopes: readonly ApiScope[];
  /** The only devices the token may reach; null = all of the user's devices. */
  deviceIds: readonly string[] | null;
}

/**
 * Who is behind a request — exactly one principal, set by `loadSession` (cookie)
 * or `authenticateBearer` (API token, /api/v1 only).
 */
export type RequestAuth = SessionPrincipal | TokenPrincipal;

const authByRequest = new WeakMap<Request, RequestAuth>();

export function setRequestAuth(req: Request, auth: RequestAuth): void {
  authByRequest.set(req, auth);
}

export function getRequestAuth(req: Request): RequestAuth | undefined {
  return authByRequest.get(req);
}

/** The principal of the request, or 401 `unauthorized`. */
export function requireAuth(req: Request): RequestAuth {
  const auth = authByRequest.get(req);
  if (auth === undefined) throw new HttpError(401, "unauthorized", "Sign in to continue.");
  return auth;
}

/**
 * The browser session of the request, for what only a person signed in with a
 * passkey may do: sessions, passkeys, live events, credentials, deleting the
 * account. 401 without a principal, 403 for an API token.
 */
export function requireSession(req: Request): SessionPrincipal {
  const auth = requireAuth(req);
  if (auth.kind !== "session") {
    throw new HttpError(
      403,
      "forbidden",
      "Only a signed-in browser can do this, not an API token.",
    );
  }
  return auth;
}

/**
 * The browser session of an administrator, or 401/403. Administration takes a
 * passkey session like the other session-only work: no API token reaches it,
 * not even an administrator's (403 `forbidden`).
 */
export function requireAdmin(req: Request): SessionPrincipal {
  const auth = requireSession(req);
  if (!auth.user.isAdmin) throw new HttpError(403, "forbidden", "Only administrators can do this.");
  return auth;
}

/** Whether the principal holds `scope`: a session holds every scope, a token only its own. */
export function hasScope(auth: RequestAuth, scope: ApiScope): boolean {
  return auth.kind === "session" || auth.scopes.includes(scope);
}
