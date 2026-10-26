import type { Request } from "express";

/** Whether the request announces a body (chunked, or a non-zero Content-Length). */
export function hasBody(req: Request): boolean {
  if (req.headers["transfer-encoding"] !== undefined) return true;
  const length = Number(req.headers["content-length"] ?? "0");
  return Number.isFinite(length) && length > 0;
}
