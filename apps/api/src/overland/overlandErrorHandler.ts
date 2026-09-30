import type { ErrorRequestHandler } from "express";
import type { Logger } from "pino";
import { toHttpError } from "../http/toHttpError";
import { sendOverlandError } from "./sendOverlandError";

/**
 * Errors of the ingest route in Overland's `{"error": "…"}` format. A 503 makes
 * the phone keep its queue and retry — nothing is lost while Postgres is down.
 */
export function overlandErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    const httpError = toHttpError(error);
    const log = req.log ?? logger;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    switch (httpError.code) {
      case "payload_too_large":
        sendOverlandError(res, 413, "Payload too large");
        return;
      case "unavailable":
        log.warn({ err: error }, "ingest refused: database unavailable");
        sendOverlandError(res, 503, "Server temporarily unavailable");
        return;
      case "internal":
        log.error({ err: error }, "ingest failed");
        sendOverlandError(res, 500, "Internal server error");
        return;
      default:
        sendOverlandError(res, httpError.status, httpError.message);
    }
  };
}
