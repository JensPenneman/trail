import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestHandler } from "express";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";
import { serializeError } from "../logging/serializeError";
import { redactUrl } from "./redactUrl";

/* An id from a trusted proxy is kept so its logs and ours line up; anything
 * unusual is replaced rather than echoed into logs and headers. */
const acceptableRequestId = /^[A-Za-z0-9._:-]{8,128}$/;

interface SerializedRequest {
  id?: unknown;
  method?: unknown;
  url?: unknown;
  headers?: Record<string, unknown>;
  remoteAddress?: unknown;
}

interface SerializedResponse {
  statusCode?: unknown;
}

/**
 * pino-http access log with an `X-Request-Id` on every response. Only what
 * helps to follow a request is logged — never bodies (coordinates), cookies,
 * the Authorization header or token query parameters.
 */
export function requestLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const incoming = req.headers["x-request-id"];
      const id =
        typeof incoming === "string" && acceptableRequestId.test(incoming)
          ? incoming
          : randomUUID();
      res.setHeader("X-Request-Id", id);
      return id;
    },
    customLogLevel: (req: IncomingMessage, res: ServerResponse, error?: Error) => {
      if (error !== undefined || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      // Container health checks every 30 s would drown everything else.
      if (req.url?.startsWith("/api/health") === true) return "debug";
      return "info";
    },
    serializers: {
      // pino-http installs its own error serializer on the child logger; keep ours.
      err: serializeError,
      req: (req: SerializedRequest) => ({
        id: req.id,
        method: req.method,
        url: typeof req.url === "string" ? redactUrl(req.url) : req.url,
        remoteAddress: req.remoteAddress,
        forwardedFor: req.headers?.["x-forwarded-for"],
        userAgent: req.headers?.["user-agent"],
      }),
      res: (res: SerializedResponse) => ({ statusCode: res.statusCode }),
    },
  });
}
