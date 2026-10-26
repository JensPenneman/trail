import { type NodeMcpRequestHandler, toNodeHandler } from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  isLegacyRequest,
  type McpHandlerRequestOptions,
  type McpServerFactory,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import type { Logger } from "pino";

/** The largest JSON-RPC message `/mcp` reads (the router's body parser enforces the same). */
export const mcpBodyLimitBytes = 1024 * 1024;

/**
 * Serves one 2025-era request (an `initialize`, or any request without the
 * 2026-07-28 envelope) from a fresh server: the stateless idiom of the SDK's
 * own fallback, except that the answer is one JSON body instead of an SSE
 * stream. Nothing outlives the exchange.
 */
function legacyJsonLeg(factory: McpServerFactory) {
  return async (request: Request, options: McpHandlerRequestOptions = {}): Promise<Response> => {
    const server = await factory({
      era: "legacy",
      ...(options.authInfo === undefined ? {} : { authInfo: options.authInfo }),
      requestInfo: request,
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: mcpBodyLimitBytes,
    });
    try {
      await server.connect(transport);
      return await transport.handleRequest(request, {
        ...(options.authInfo === undefined ? {} : { authInfo: options.authInfo }),
        ...(options.parsedBody === undefined ? {} : { parsedBody: options.parsedBody }),
      });
    } finally {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
    }
  };
}

/**
 * The MCP endpoint as an Express-compatible `(req, res, body)` handler: one
 * server per request from `factory`, answers as single JSON bodies. Requests
 * of the 2026-07-28 revision (a `_meta` envelope on every request) go to the
 * SDK's per-request handler, strict about that revision; 2025-era requests,
 * which every client before it sends, to a stateless JSON leg — routed by the
 * SDK's own classifier, so the two can never disagree about a request.
 * `toNodeHandler` adapts the fetch-shaped composition to Node; the router in
 * front of it has verified the token, the origin, the method and the body.
 *
 * `onerror` receives what the SDK reports out of band: refused requests and
 * failures. Its messages may quote what a client sent, so they are logged at
 * debug level only.
 */
export function createMcpEndpoint(
  factory: McpServerFactory,
  logger: Logger,
): NodeMcpRequestHandler {
  const report = (error: Error): void => {
    logger.debug({ err: error }, "MCP request refused or failed");
  };
  const modern = createMcpHandler(factory, {
    legacy: "reject",
    // One JSON body unless a handler sends a notification before its result, which none of
    // Trail's does (the tests check every answer's type). `json` would promise the same, and
    // print a warning to the console on every start.
    responseMode: "auto",
    maxRequestBodySize: mcpBodyLimitBytes,
    onerror: report,
  });
  const legacy = legacyJsonLeg(factory);
  return toNodeHandler(
    {
      fetch: async (request, options) =>
        (await isLegacyRequest(request, options?.parsedBody, {
          maxRequestBodySize: mcpBodyLimitBytes,
        }))
          ? legacy(request, options)
          : modern.fetch(request, options),
    },
    { maxRequestBodySize: mcpBodyLimitBytes, onerror: report },
  );
}
