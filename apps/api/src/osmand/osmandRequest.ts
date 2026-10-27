import type { IncomingMessage } from "node:http";
import type { Request, RequestHandler } from "express";
import { previewText } from "../ingest/previewText";

/** One request in the OsmAnd format: its parameters, and a JSON body parsed once the device is known. */
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

/** What `readOsmandRequest` read before the token lookup. */
interface ReadRequest {
  params: Map<string, string>;
  overflow: boolean;
  /** A JSON body's text: parsed only once the device is known (`osmandRequestOf`). */
  jsonText: string | null;
  parsed: OsmandRequest | null;
}

const requests = new WeakMap<Request, ReadRequest>();

/**
 * Traccar Client 9's body: `application/json` (or a `+json` type); any other
 * body is parameters. A function of the raw request, as the body parser takes it.
 */
export function isJsonBody(req: IncomingMessage): boolean {
  return /^application\/(?:[\w.+-]+\+)?json\s*(?:;|$)/i.test(req.headers["content-type"] ?? "");
}

/**
 * Reads the parameters of a query or a form as `URLSearchParams` does — `&`
 * between them, `=` between a name and its value, `+` for a space, percent
 * escapes decoded — keeping the first value of each name, but no more than
 * `budget.left` parts: what follows is never looked at, so a body costs no
 * more than its first hundred parameters, whatever its size. True when there
 * was more.
 */
export function readParameters(
  text: string,
  into: Map<string, string>,
  budget: { left: number },
): boolean {
  let start = 0;
  while (start < text.length) {
    if (budget.left === 0) return true;
    budget.left -= 1;
    const separator = text.indexOf("&", start);
    const end = separator < 0 ? text.length : separator;
    if (end > start) {
      for (const [name, value] of new URLSearchParams(text.slice(start, end))) {
        if (!into.has(name)) into.set(name, value);
      }
    }
    start = end + 1;
  }
  return false;
}

/**
 * Reads a request in the OsmAnd format before its token is looked up, as
 * cheaply as that allows: the query's parameters and, for a form or a body
 * without a type (Traccar Client 10 posts a form), the form's — at most 100
 * together. A JSON body stays text: before the lookup only its `device_id` is
 * looked for (`jsonDeviceId`); it is parsed once the device is known. The
 * body is raw, at most 64 kB and never decompressed (`osmandRouter`).
 */
export const readOsmandRequest: RequestHandler = (req, _res, next) => {
  const params = new Map<string, string>();
  const budget = { left: maxParameters };
  const query = req.originalUrl.indexOf("?");
  let overflow = query >= 0 && readParameters(req.originalUrl.slice(query + 1), params, budget);
  let jsonText: string | null = null;
  const body: unknown = req.body;
  if (Buffer.isBuffer(body) && body.length > 0) {
    const text = body.toString("utf8").replace(/^﻿/, "");
    if (isJsonBody(req)) jsonText = text;
    else overflow = readParameters(text, params, budget) || overflow;
  }
  requests.set(req, { params, overflow, jsonText, parsed: null });
  next();
};

function readRequestOf(req: Request): ReadRequest {
  const request = requests.get(req);
  if (request === undefined) throw new Error("OsmAnd route reached without its parameters");
  return request;
}

/** The query and form parameters, as `readOsmandRequest` read them before the lookup. */
export function osmandParametersOf(req: Request): ReadonlyMap<string, string> {
  return readRequestOf(req).params;
}

/* Traccar Client 9's `device_id`, in the JSON text as the plugin writes it. */
const deviceIdPattern = /"device_id"\s*:\s*"(trl_[A-Za-z0-9_-]{43})"/;

/** A token-shaped `device_id` of a JSON body, found without parsing it: one pass over at most 64 kB. */
export function jsonDeviceId(req: Request): string | null {
  const { jsonText } = readRequestOf(req);
  return jsonText === null ? null : (deviceIdPattern.exec(jsonText)?.[1] ?? null);
}

/** The whole request, its JSON body parsed — for the handler, once the device is known. */
export function osmandRequestOf(req: Request): OsmandRequest {
  const request = readRequestOf(req);
  if (request.parsed !== null) return request.parsed;
  const { params, overflow, jsonText } = request;
  let json: OsmandRequest["json"] = null;
  if (jsonText !== null) {
    try {
      json = { ok: true, value: JSON.parse(jsonText) as unknown };
    } catch {
      json = { ok: false, preview: previewText(jsonText) };
    }
  }
  request.parsed = { params, overflow, json };
  return request.parsed;
}
