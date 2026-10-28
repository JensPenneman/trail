import type { z } from "zod";
import { ApiError } from "./ApiError";
import { readApiAnswer } from "./readApiAnswer";
import { readApiError } from "./readApiError";
import { type ApiRequest, sendApiRequest } from "./sendApiRequest";

/**
 * Calls the Trail API and validates the answer against its contract schema, so
 * a response that drifted from `@trail/contracts` fails loudly here instead of
 * deep inside a component. Empty (204) answers are validated as `undefined`.
 * A `304 Not Modified` it never asked for (only `cachedFetch` sends
 * `If-None-Match`) is an answer it cannot use.
 */
export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  request: ApiRequest = {},
): Promise<T> {
  const response = await sendApiRequest(path, request);
  if (response.status === 304) {
    throw new ApiError({
      status: 304,
      code: "invalid_response",
      message: "The server answered in a format this version of Trail does not understand.",
    });
  }
  if (!response.ok) throw await readApiError(response);
  return readApiAnswer(response, schema);
}
