import type { IngestProtocol } from "@trail/contracts/deviceApp";
import type { Request, RequestHandler } from "express";
import type { AppContext } from "../appContext";
import { sendIngestError } from "./sendIngestError";

/* The configurations that warned already: one warning per app is enough. */
const warned = new WeakSet<object>();

/** Whether the nearest proxy says the request came over HTTPS (its first `X-Forwarded-Proto`). */
const forwardedAsHttps = (req: Request): boolean =>
  req.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() === "https";

/**
 * One rule for every credential the ingest endpoints take — a bearer token,
 * the HTTP Basic password, a query or form parameter, a JSON `device_id` —
 * set by the address the phones were given (`INGEST_BASE_URL`, else
 * `PUBLIC_URL`). An `https:` address means an upload over plain HTTP is
 * refused with 403 before anything is read or looked up: `req.secure`, which
 * for Trail, serving plain HTTP, is a trusted proxy's `X-Forwarded-Proto:
 * https` (`TRUST_PROXY`), the rule of the `__Host-` session cookie. Trail
 * refuses to start with such an address and no trusted proxy; should a proxy
 * it does not trust say HTTPS, the refusals are logged once, as a hint at
 * `TRUST_PROXY`. An `http:` address — a home network while Trail is set up —
 * takes every credential over HTTP, Basic included: the phones were told to
 * use it, and refusing one scheme there would protect nothing.
 */
export function refuseCredentialsOverHttp(
  ctx: Pick<AppContext, "config" | "logger">,
  protocol: IngestProtocol,
): RequestHandler {
  const { config, logger } = ctx;
  const message = `Uploads need HTTPS: use ${config.ingestUrls[protocol]}`;
  return (req, res, next) => {
    if (!config.ingestHttpsOnly || req.secure) {
      next();
      return;
    }
    if (!warned.has(config) && forwardedAsHttps(req)) {
      warned.add(config);
      (req.log ?? logger).warn(
        { remoteAddress: req.socket.remoteAddress, trustProxy: config.trustProxy },
        "uploads refused: a proxy that TRUST_PROXY does not trust says they came over HTTPS",
      );
    }
    sendIngestError(res, 403, message);
  };
}
