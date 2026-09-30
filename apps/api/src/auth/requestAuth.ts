import type { Request } from "express";
import type { users } from "../db/schema/users";
import { HttpError } from "../http/httpError";

export type UserRow = typeof users.$inferSelect;

/** The signed-in user and session behind a request (set by `loadSession`). */
export interface RequestAuth {
  user: UserRow;
  sessionId: string;
}

const authByRequest = new WeakMap<Request, RequestAuth>();

export function setRequestAuth(req: Request, auth: RequestAuth): void {
  authByRequest.set(req, auth);
}

export function getRequestAuth(req: Request): RequestAuth | undefined {
  return authByRequest.get(req);
}

/** The session of the request, or 401 `unauthorized`. */
export function requireAuth(req: Request): RequestAuth {
  const auth = authByRequest.get(req);
  if (auth === undefined) throw new HttpError(401, "unauthorized", "Sign in to continue.");
  return auth;
}

/** The session of an administrator, or 401/403. */
export function requireAdmin(req: Request): RequestAuth {
  const auth = requireAuth(req);
  if (!auth.user.isAdmin) throw new HttpError(403, "forbidden", "Only administrators can do this.");
  return auth;
}
