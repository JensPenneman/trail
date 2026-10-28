import type { z } from "zod";
import { ApiError } from "./ApiError";
import { isAbort } from "./sendApiRequest";

/**
 * The body of a successful answer, checked against its contract schema, so a
 * response that drifted from `@trail/contracts` fails loudly here instead of
 * deep inside a component. Empty (204) answers are checked as `undefined`.
 */
export async function readApiAnswer<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
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
