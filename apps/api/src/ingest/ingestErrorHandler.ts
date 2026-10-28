import type { ErrorRequestHandler } from "express";
import type { Logger } from "pino";
import { toHttpError } from "../http/toHttpError";
import { sendIngestError } from "./sendIngestError";

/**
 * Errors of the ingest endpoints in their `{"error": "…"}` format. A 503 makes
 * the phone keep its data and retry — nothing is lost while Postgres is down.
 * Errors are logged without the request body (`serializeError` drops it): a
 * body may hold a device token.
 */
export function ingestErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    const httpError = toHttpError(error);
    const log = req.log ?? logger;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    switch (httpError.code) {
      case "payload_too_large":
        sendIngestError(res, 413, "Payload too large");
        return;
      case "unavailable":
        log.warn({ err: error }, "ingest refused: database unavailable");
        sendIngestError(res, 503, "Server temporarily unavailable");
        return;
      case "internal":
        log.error({ err: error }, "ingest failed");
        sendIngestError(res, 500, "Internal server error");
        return;
      default:
        sendIngestError(res, httpError.status, httpError.message);
    }
  };
}
