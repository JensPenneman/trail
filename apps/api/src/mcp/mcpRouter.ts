import express, { type ErrorRequestHandler, type RequestHandler, type Router } from "express";
import type { AppContext } from "../appContext";
import { getRequestAuth } from "../auth/requestAuth";
import { hasBody } from "../http/hasBody";
import { HttpError, notFound } from "../http/httpError";
import { noStore } from "../http/noStore";
import { sendApiError } from "../http/sendApiError";
import { toHttpError } from "../http/toHttpError";
import { authenticateBearer } from "../v1/authenticateBearer";
import { createTrailMcpServer } from "./createTrailMcpServer";
import { McpCall } from "./mcpCall";
import { mcpCorsHeaders, mcpPreflight } from "./mcpCors";
import { createMcpEndpoint, mcpBodyLimitBytes } from "./mcpEndpoint";
import { mcpOriginGuard } from "./mcpOriginGuard";

/** Without a token there is nothing to answer: the session cookie is never read here. */
const requireApiToken: RequestHandler = (req, res, next) => {
  if (getRequestAuth(req)?.kind === "token") {
    next();
    return;
  }
  res.setHeader("WWW-Authenticate", 'Bearer realm="trail"');
  sendApiError(
    res,
    new HttpError(
      401,
      "unauthorized",
      "Send an API token as Authorization: Bearer trlk_…; create one in Settings › API tokens.",
    ),
  );
};

/**
 * Stateless Streamable HTTP has nothing for GET (no stream to open) or
 * DELETE (no session to end): 405, which MCP clients expect from such a
 * server. A POST must carry one JSON body.
 */
const postJsonOnly: RequestHandler = (req, res, next) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendApiError(
      res,
      new HttpError(
        405,
        "method_not_allowed",
        "Trail's MCP server is stateless: send every message as a POST.",
      ),
    );
    return;
  }
  if (!hasBody(req)) {
    sendApiError(res, new HttpError(400, "bad_request", "Send one JSON-RPC message as the body."));
    return;
  }
  if (req.is("application/json") === false) {
    sendApiError(
      res,
      new HttpError(415, "bad_request", "Send the request body as application/json."),
    );
    return;
  }
  next();
};

/**
 * `/mcp` (docs/mcp.md), mounted before compression and the dashboard's `/api`
 * chain so it sets its own order: CORS headers (so a browser client can read
 * every refusal, as on `/api/v1`) → the per-address limiter the whole API
 * shares → the `Origin` check → preflight → the API token (bearer only: the
 * session cookie is never read, and the failed-token limiter counts refusals)
 * → the per-token limiter `/api/v1` shares → POST with JSON only → the 1 MB
 * body parser → the SDK. Refusals before the SDK use the API's error body;
 * once the SDK has the request, it answers in JSON-RPC.
 */
export function mcpRouter(
  ctx: AppContext,
  limits: { perAddress: RequestHandler; perToken: RequestHandler },
): Router {
  const endpoint = createMcpEndpoint((request) => {
    const call = McpCall.of(request.authInfo);
    return createTrailMcpServer({ ctx, principal: call.principal, log: call.log });
  }, ctx.logger);

  const router = express.Router();
  router.use(noStore);
  router.use(mcpCorsHeaders);
  router.use(limits.perAddress);
  router.use(mcpOriginGuard(ctx.config.mcpAllowedOrigins));
  router.use(mcpPreflight);
  router.use(authenticateBearer(ctx));
  router.use(requireApiToken);
  router.use(limits.perToken);
  router.all("/", postJsonOnly);
  router.post("/", express.json({ limit: mcpBodyLimitBytes, type: "application/json" }));
  router.post("/", async (req, res) => {
    const principal = getRequestAuth(req);
    if (principal?.kind !== "token") throw new Error("/mcp reached the SDK without a token");
    const call = new McpCall(principal, req.log);
    await endpoint(Object.assign(req, { auth: call.toAuthInfo() }), res, req.body);
  });
  router.use((_req, res) => {
    sendApiError(res, notFound("No such MCP endpoint: it is /mcp."));
  });
  const errors: ErrorRequestHandler = (error, req, res, _next) => {
    const httpError = toHttpError(error);
    if (httpError.status >= 500) req.log.error({ err: error }, "MCP request failed");
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendApiError(res, httpError);
  };
  router.use(errors);
  return router;
}
