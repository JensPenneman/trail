import type { IncomingMessage } from "node:http";
import type { Request, RequestHandler } from "express";
import { storableText } from "../ingest/storableText";
import { redactSecrets } from "../ingest/withoutSecrets";

/** One request in the OsmAnd format, its parameters read once for the token and the record. */
export interface OsmandRequest {
  /** Query and form parameters, the first value of each name, the query's first. */
  params: ReadonlyMap<string, string>;
  /** More parameters than any client sends: kept in the dead letter, not read. */
  overflow: boolean;
  /** A JSON body — Traccar Client 9's format — or null for a query or a form. */
  json: { ok: true; value: unknown } | { ok: false; preview: string } | null;
}

/** Traccar's own clients send about a dozen; GPSLogger's whole set is 26. */
const maxParameters = 100;

const requests = new WeakMap<Request, OsmandRequest>();

/**
 * Traccar Client 9's body: `application/json` (or a `+json` type); any other
 * body is parameters. A function of the raw request, as the body parser takes it.
 */
export function isJsonBody(req: IncomingMessage): boolean {
  return /^application\/(?:[\w.+-]+\+)?json\s*(?:;|$)/i.test(req.headers["content-type"] ?? "");
}

function collect(
  into: Map<string, string>,
  search: URLSearchParams,
  counted: { total: number },
): void {
  for (const [name, value] of search) {
    counted.total += 1;
    if (counted.total > maxParameters) return;
    if (!into.has(name)) into.set(name, value);
  }
}

/**
 * Reads the parameters of a GET or POST in the OsmAnd format: the query
 * string, and the body when it is a form (Traccar Client 10 posts one) or has
 * no type; a JSON body is kept as JSON. Before the token is looked up, since
 * Traccar Client sends its identifier — the token — in the form.
 */
export const readOsmandRequest: RequestHandler = (req, _res, next) => {
  const params = new Map<string, string>();
  const counted = { total: 0 };
  const query = req.originalUrl.indexOf("?");
  if (query >= 0) collect(params, new URLSearchParams(req.originalUrl.slice(query + 1)), counted);
  let json: OsmandRequest["json"] = null;
  const body: unknown = req.body;
  if (Buffer.isBuffer(body) && body.length > 0) {
    const text = body.toString("utf8").replace(/^﻿/, "");
    if (isJsonBody(req)) {
      try {
        json = { ok: true, value: JSON.parse(text) as unknown };
      } catch {
        // Redacted whole, then cut: a token cut in half would no longer be recognised.
        json = { ok: false, preview: storableText(redactSecrets(text).slice(0, 2000)) };
      }
    } else {
      collect(params, new URLSearchParams(text), counted);
    }
  }
  requests.set(req, { params, overflow: counted.total > maxParameters, json });
  next();
};

/** The request as `readOsmandRequest` read it; routes behind it always have one. */
export function osmandRequestOf(req: Request): OsmandRequest {
  const request = requests.get(req);
  if (request === undefined) throw new Error("OsmAnd route reached without its parameters");
  return request;
}
