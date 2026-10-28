import { ApiError } from "./ApiError";
import { apiUrl, type QueryValue } from "./apiUrl";

export interface ApiRequest {
  /** Defaults to GET without a body and POST with one. */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Readonly<Record<string, QueryValue>>;
  /** Sent as JSON; the API's CSRF check requires JSON bodies on unsafe methods. */
  body?: unknown;
  /** Extra request headers, e.g. the secret of a public link (`X-Share-Secret`). */
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

/* Aborts are the caller's own doing (TanStack Query cancelling a stale request)
 * and must propagate unchanged. DOMException is not an Error subclass everywhere. */
export function isAbort(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) return false;
  return error.name === "AbortError" || error.name === "TimeoutError";
}

/** Sends a request to the Trail API; a request that never reached it is the `network` ApiError. */
export async function sendApiRequest(path: string, request: ApiRequest = {}): Promise<Response> {
  const hasBody = request.body !== undefined;
  const headers: Record<string, string> = { ...request.headers, Accept: "application/json" };
  if (hasBody) headers["Content-Type"] = "application/json";
  try {
    return await fetch(apiUrl(path, request.query), {
      method: request.method ?? (hasBody ? "POST" : "GET"),
      headers,
      credentials: "same-origin",
      ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError({
      status: 0,
      code: "network",
      message: "Can’t reach the Trail server. Check your connection and try again.",
      cause: error,
    });
  }
}
