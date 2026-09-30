import compression from "compression";
import type { RequestHandler } from "express";

/**
 * gzip/brotli for JSON, exports and the SPA — but never for the SSE stream:
 * a compressor buffers output, so events would sit in it instead of reaching
 * the browser (docs/architecture.md §9).
 */
export function compress(): RequestHandler {
  return compression({
    filter: (req, res) => {
      const type = res.getHeader("Content-Type");
      if (typeof type === "string" && type.startsWith("text/event-stream")) return false;
      return compression.filter(req, res);
    },
  });
}
