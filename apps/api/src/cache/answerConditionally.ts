import type { Request, Response } from "express";
import { etagMatches } from "./etagMatches";

/**
 * Answers a GET of the dashboard's private API conditionally
 * (docs/architecture.md §8.9). The ETag comes from a validator read before
 * the heavy work: when the request's `If-None-Match` names it, the answer is
 * `304 Not Modified` without a body and `build` never runs; otherwise `build`
 * makes the body, which goes out with the ETag — set only now, so an answer
 * that failed on the way never carries it. `Cache-Control: no-store` and
 * `X-Request-Id` stay as on every `/api` answer. Returns the status sent, for
 * the data access log, where a 304 is a look like a 200 (§8.8).
 */
export async function answerConditionally(
  req: Request,
  res: Response,
  etag: string,
  build: () => unknown,
): Promise<200 | 304> {
  if (etagMatches(req.get("if-none-match"), etag)) {
    res.setHeader("ETag", etag);
    res.status(304).end();
    return 304;
  }
  const body = await build();
  res.setHeader("ETag", etag);
  res.json(body);
  return 200;
}
