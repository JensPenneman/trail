import { apiErrorSchema, type ErrorCode } from "@trail/contracts/errors";
import { ApiError } from "./ApiError";

const statusFallbacks: Readonly<Record<number, { code: ErrorCode; message: string }>> = {
  401: { code: "unauthorized", message: "Your session has ended. Sign in again." },
  403: { code: "forbidden", message: "You are not allowed to do that." },
  404: { code: "not_found", message: "That does not exist (any more)." },
  413: { code: "payload_too_large", message: "That is too large for the server." },
  429: { code: "rate_limited", message: "Too many requests. Wait a moment and try again." },
  502: { code: "unavailable", message: "The Trail server is not reachable right now." },
  503: { code: "unavailable", message: "The Trail server is temporarily unavailable." },
  504: { code: "unavailable", message: "The Trail server took too long to answer." },
};

/**
 * Turns a non-2xx response into an ApiError. The body should be the contract's
 * `{ error: { code, message, fields } }`; a proxy in front of the API may send
 * something else, which still yields a sensible code and message.
 */
export async function readApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const parsed = apiErrorSchema.safeParse(body);
  if (parsed.success) {
    const { code, message, fields } = parsed.data.error;
    return new ApiError({
      status: response.status,
      code,
      message,
      ...(fields === undefined ? {} : { fields }),
    });
  }
  const fallback = statusFallbacks[response.status];
  if (fallback !== undefined) return new ApiError({ status: response.status, ...fallback });
  if (response.status >= 500) {
    return new ApiError({
      status: response.status,
      code: "internal",
      message: "The Trail server ran into a problem. Try again in a moment.",
    });
  }
  return new ApiError({
    status: response.status,
    code: "bad_request",
    message: "The request was not accepted.",
  });
}
