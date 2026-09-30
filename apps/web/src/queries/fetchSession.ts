import { apiPaths } from "@trail/contracts/apiPaths";
import { type SessionUser, sessionResponseSchema } from "@trail/contracts/user";
import { ApiError } from "../api/ApiError";
import { apiFetch } from "../api/apiFetch";

/** The signed-in person, or null when there is no valid session (the API answers 401). */
export async function fetchSession(signal?: AbortSignal): Promise<SessionUser | null> {
  try {
    const response = await apiFetch(apiPaths.auth.session, sessionResponseSchema, {
      ...(signal === undefined ? {} : { signal }),
    });
    return response.user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}
