import { performance } from "node:perf_hooks";
import type { RequestHandler, Response } from "express";
import { getRequestAuth } from "../auth/requestAuth";
import { accountTagger } from "./accountTag";
import { daySpan } from "./daySpan";
import { isPerDay } from "./requestBudgets";
import type { RequestStats } from "./requestStats";
import { areaOf, followRoute } from "./routePattern";

/**
 * What the request log adds to a request's line once it is answered
 * (docs/architecture.md §12): the route's pattern, never its path; the time
 * until the answer was handed to the network; the bytes of its body as sent;
 * whether the client asked conditionally and, if so, whether its copy was
 * current (`hit`, a 304); the account's opaque tag; the days `from` and `to`
 * span. No id, coordinate or other query value.
 */
export interface RequestFacts {
  route: string;
  ms: number;
  bytes: number;
  conditional: boolean;
  cache?: "hit" | "miss";
  account?: string;
  days?: number;
  /** The client went away before the answer was out; not counted in the summary. */
  aborted?: true;
}

const factsByResponse = new WeakMap<Response, RequestFacts>();

/** The facts of an answered request, for its log line. */
export function requestFactsOf(res: Response): RequestFacts | undefined {
  return factsByResponse.get(res);
}

const sizeOf = (chunk: unknown, encoding: unknown): number => {
  if (typeof chunk === "string") {
    return Buffer.byteLength(
      chunk,
      typeof encoding === "string" ? (encoding as BufferEncoding) : "utf8",
    );
  }
  return chunk instanceof Uint8Array ? chunk.byteLength : 0;
};

/**
 * Times every request and counts it in `stats` under `METHOD /pattern`
 * (docs/architecture.md §8.10). Mounted first, so its time starts before
 * everything else and its bytes are those compression hands on; a stream of
 * server-sent events, whose length is how long a tab stayed open, is logged
 * but not counted. A few counters per request: nothing is written anywhere.
 */
export function requestTiming(stats: RequestStats): RequestHandler {
  const tagOf = accountTagger();
  return (req, res, next) => {
    const start = performance.now();
    const pattern = followRoute(req);
    let bytes = 0;
    const write = res.write;
    const end = res.end;
    res.write = function (this: Response, chunk: unknown, ...rest: unknown[]) {
      bytes += sizeOf(chunk, rest[0]);
      return (write as (...args: unknown[]) => boolean).call(this, chunk, ...rest);
    } as typeof res.write;
    res.end = function (this: Response, chunk?: unknown, ...rest: unknown[]) {
      bytes += sizeOf(chunk, rest[0]);
      return (end as (...args: unknown[]) => Response).call(this, chunk, ...rest);
    } as typeof res.end;

    const done = () => {
      res.off("finish", done);
      res.off("close", done);
      const ms = Math.round((performance.now() - start) * 10) / 10;
      const route = pattern() ?? areaOf(req.originalUrl.split("?", 1)[0] ?? "/");
      const conditional =
        req.headers["if-none-match"] !== undefined ||
        req.headers["if-modified-since"] !== undefined;
      const user = getRequestAuth(req)?.user.id;
      const days = daySpan(req.originalUrl);
      const finished = res.writableFinished;
      const facts: RequestFacts = {
        route,
        ms,
        bytes,
        conditional,
        ...(conditional ? { cache: res.statusCode === 304 ? "hit" : "miss" } : {}),
        ...(user === undefined ? {} : { account: tagOf(user) }),
        ...(days === null ? {} : { days }),
        ...(finished ? {} : { aborted: true }),
      };
      factsByResponse.set(res, facts);
      const type = res.getHeader("Content-Type");
      const stream = typeof type === "string" && type.startsWith("text/event-stream");
      if (finished && !stream) {
        const key = `${req.method} ${route}`;
        const longRange = days !== null && days > 1 && isPerDay(key);
        stats.record(key, ms, { status: res.statusCode, bytes }, longRange);
      }
    };
    res.on("finish", done);
    res.on("close", done);
    next();
  };
}
