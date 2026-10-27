import type { IngestProtocol } from "@trail/contracts/deviceApp";
import type { RequestHandler } from "express";
import type { Config } from "../config/config";
import { sendIngestError } from "./sendIngestError";

/**
 * One rule for every credential the ingest endpoints take — a bearer token,
 * the HTTP Basic password, a query or form parameter, a JSON `device_id` —
 * set by the address the phones were given (`INGEST_BASE_URL`, else
 * `PUBLIC_URL`). An `https:` address means an upload over plain HTTP is
 * refused with 403 before anything is read or looked up: `req.secure`, TLS to
 * Trail itself or a trusted proxy's `X-Forwarded-Proto: https`
 * (`TRUST_PROXY`), the rule of the `__Host-` session cookie. An `http:`
 * address — a home network while Trail is set up — takes every credential
 * over HTTP, Basic included: the phones were told to use it, and refusing one
 * scheme there would protect nothing.
 */
export function refuseCredentialsOverHttp(
  config: Pick<Config, "ingestHttpsOnly" | "ingestUrls">,
  protocol: IngestProtocol,
): RequestHandler {
  const message = `Uploads need HTTPS: use ${config.ingestUrls[protocol]}`;
  return (req, res, next) => {
    if (!config.ingestHttpsOnly || req.secure) {
      next();
      return;
    }
    sendIngestError(res, 403, message);
  };
}
