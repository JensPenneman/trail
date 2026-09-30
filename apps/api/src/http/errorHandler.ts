import type { ErrorRequestHandler } from "express";
import type { Logger } from "pino";
import { sendApiError } from "./sendApiError";
import { toHttpError } from "./toHttpError";

/**
 * Final error middleware. API routes get the contract JSON body, other paths
 * plain text; stack traces are logged, never sent. Express's own handler is
 * never reached (it prints stacks to stderr outside the "test" env).
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    const httpError = toHttpError(error);
    const log = req.log ?? logger;
    if (httpError.status >= 500) log.error({ err: error }, "request failed");
    else log.debug({ err: error }, "request rejected");

    if (res.headersSent) {
      // A streamed response broke half-way: the only honest signal left is to drop it.
      res.destroy();
      return;
    }
    if (req.originalUrl.startsWith("/api/") || req.originalUrl === "/api") {
      sendApiError(res, httpError);
      return;
    }
    res.status(httpError.status).type("text/plain").send(httpError.message);
  };
}
