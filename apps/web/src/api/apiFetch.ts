import type { z } from "zod";
import { ApiError } from "./ApiError";
import { apiUrl, type QueryValue } from "./apiUrl";
import { readApiError } from "./readApiError";

export interface ApiRequest {
  /** Defaults to GET without a body and POST with one. */
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Readonly<Record<string, QueryValue>>;
  /** Sent as JSON; the API's CSRF check requires JSON bodies on unsafe methods. */
  body?: unknown;
  signal?: AbortSignal;
}

/* Aborts are the caller's own doing (TanStack Query cancelling a stale request)
 * and must propagate unchanged. DOMException is not an Error subclass everywhere. */
function isAbort(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) return false;
  return error.name === "AbortError" || error.name === "TimeoutError";
}

/**
 * Calls the Trail API and validates the answer against its contract schema, so
 * a response that drifted from `@trail/contracts` fails loudly here instead of
 * deep inside a component. Empty (204) answers are validated as `undefined`.
 */
export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  request: ApiRequest = {},
): Promise<T> {
  const hasBody = request.body !== undefined;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (hasBody) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(apiUrl(path, request.query), {
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

  if (!response.ok) throw await readApiError(response);

  let payload: unknown;
  try {
    const text = await response.text();
    payload = text === "" ? undefined : JSON.parse(text);
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError({
      status: response.status,
      code: "invalid_response",
      message: "The server sent a response Trail could not read.",
      cause: error,
    });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError({
      status: response.status,
      code: "invalid_response",
      message: "The server answered in a format this version of Trail does not understand.",
      cause: parsed.error,
    });
  }
  return parsed.data;
}
