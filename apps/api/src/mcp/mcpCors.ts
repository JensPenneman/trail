import type { RequestHandler } from "express";

/*
 * What a page may send: the token, JSON, and the MCP transport's own headers —
 * the protocol version of either era, the 2026-07-28 request metadata
 * (`Mcp-Method`, `Mcp-Name`) and the session id older clients may still send
 * (stateless: it is ignored).
 */
const allowedHeaders =
  "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Mcp-Method, Mcp-Name";

/* GET and DELETE are allowed through the preflight only to receive the 405 that
 * MCP clients expect from a stateless server; a CORS failure looks like a
 * network error to them. */
const allowedMethods = "GET, POST, DELETE";

const exposedHeaders = "RateLimit, RateLimit-Policy, Retry-After, WWW-Authenticate, X-Request-Id";

/**
 * CORS headers on every `/mcp` response, refusals and rate limits included, so
 * a browser-based client can read why a request failed — as on `/api/v1`. Any
 * origin is answered with `*` and never with credentials: a page can only use
 * an API token, never the visitor's session. Which origins may call at all is
 * `mcpOriginGuard`'s decision.
 */
export const mcpCorsHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", exposedHeaders);
  next();
};

/** Answers a preflight (any `OPTIONS`) before the token is looked at: a preflight carries none. */
export const mcpPreflight: RequestHandler = (req, res, next) => {
  if (req.method !== "OPTIONS") {
    next();
    return;
  }
  res.setHeader("Access-Control-Allow-Methods", allowedMethods);
  res.setHeader("Access-Control-Allow-Headers", allowedHeaders);
  res.setHeader("Access-Control-Max-Age", "600");
  res.status(204).end();
};
