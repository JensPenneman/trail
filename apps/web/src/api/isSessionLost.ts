import { ApiError } from "./ApiError";

/**
 * True when a request failed because the session cookie is missing, expired or
 * revoked. `unknown_credential` is also a 401 but belongs to the sign-in
 * ceremony (a deleted passkey), not to an existing session.
 */
export function isSessionLost(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && error.code !== "unknown_credential";
}
