import { isDatabaseUnavailable } from "../db/isDatabaseUnavailable";
import { HttpError } from "./httpError";

interface StatusError {
  status: number;
  type?: unknown;
}

/* body-parser, send and other http-errors based modules throw errors that carry
 * a `status` (and body-parser a `type`). */
const hasStatus = (error: unknown): error is StatusError =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  typeof error.status === "number";

/** Maps anything thrown by a route to the response it should produce. */
export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (hasStatus(error) && error.status >= 400 && error.status < 500) {
    if (error.type === "entity.too.large") {
      return new HttpError(413, "payload_too_large", "The request body is too large.");
    }
    if (error.type === "entity.parse.failed") {
      return new HttpError(400, "bad_request", "The request body is not valid JSON.");
    }
    if (error.status === 415) {
      return new HttpError(415, "bad_request", "Unsupported request body encoding.");
    }
    return new HttpError(error.status, "bad_request", "The request could not be processed.");
  }
  if (isDatabaseUnavailable(error)) {
    return new HttpError(
      503,
      "unavailable",
      "The database is temporarily unavailable. Try again shortly.",
    );
  }
  return new HttpError(500, "internal", "Something went wrong on the server.");
}
