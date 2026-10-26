import type { Request, RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import type { AppContext } from "../appContext";
import { setRequestAuth } from "../auth/requestAuth";
import { HttpError } from "../http/httpError";
import { rateLimitLogger } from "../http/rateLimitLogger";
import { sendApiError } from "../http/sendApiError";
import { apiTokenPattern, type TokenRejection } from "./apiTokens";

/** `WWW-Authenticate` of a refused token (RFC 6750 §3). */
const invalidToken = 'Bearer realm="trail", error="invalid_token"';

type Refusal = TokenRejection["reason"] | "malformed";

const refusals = new WeakMap<Request, Refusal>();

/** `Authorization` in the Bearer scheme, whose name is case-insensitive (RFC 9110 §11.1). */
const bearerScheme = /^Bearer(?:[ \t]|$)/i;

/** The secret of `Bearer <secret>` if it has the shape of an API token; null for anything else. */
function bearerSecret(header: string): string | null {
  const secret = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header)?.[1] ?? null;
  return secret !== null && apiTokenPattern.test(secret) ? secret : null;
}

/**
 * API token authentication for `/api/v1` (docs/architecture.md §8.3). A request
 * whose `Authorization` header uses the Bearer scheme is a bearer request: its
 * token must have the `trlk_` shape (else no lookup) and pass
 * `ctx.apiTokens.verify`, and it then becomes the request's principal — the
 * session cookie is never looked at. A refused token answers 401 once the
 * failed-token limiter has counted it; that limiter (per address, like the
 * ingest's) skips valid tokens, so a scanner sharing an address with a client
 * never locks the client out. Requests without the header, or with another
 * scheme (`Basic` from a proxy in front, say), carry no API token: they pass
 * through to the session.
 */
export function authenticateBearer(ctx: AppContext): RequestHandler[] {
  const identify: RequestHandler = async (req, _res, next) => {
    const header = req.get("authorization");
    if (header === undefined || !bearerScheme.test(header)) {
      next();
      return;
    }
    const secret = bearerSecret(header);
    if (secret === null) {
      refusals.set(req, "malformed");
      next();
      return;
    }
    const outcome = await ctx.apiTokens.verify(secret, { ip: req.ip ?? null });
    if ("reason" in outcome) refusals.set(req, outcome.reason);
    else setRequestAuth(req, outcome);
    next();
  };

  const failedTokens = rateLimit({
    windowMs: 10 * 60_000,
    limit: ctx.config.rateLimits.tokenFailedPer10Minutes,
    skip: (req) => !refusals.has(req),
    identifier: "failed-token",
    standardHeaders: "draft-8",
    legacyHeaders: false,
    logger: rateLimitLogger(ctx.logger),
    handler: (_req, res) => {
      sendApiError(
        res,
        new HttpError(429, "rate_limited", "Too many invalid API tokens. Wait a few minutes."),
      );
    },
  });

  const refuse: RequestHandler = (req, res, next) => {
    const refusal = refusals.get(req);
    if (refusal === undefined) {
      next();
      return;
    }
    req.log.debug({ refusal }, "API token refused");
    res.setHeader("WWW-Authenticate", invalidToken);
    sendApiError(
      res,
      refusal === "expired"
        ? new HttpError(401, "token_expired", "This API token has expired. Create a new one.")
        : new HttpError(401, "unauthorized", "This API token is not valid."),
    );
  };

  return [identify, failedTokens, refuse];
}
