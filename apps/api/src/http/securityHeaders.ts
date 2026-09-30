import type { RequestHandler } from "express";
import helmet, { type HelmetOptions } from "helmet";
import { permissionsPolicy } from "./permissionsPolicy";

const twoYearsInSeconds = 63_072_000;

function helmetFor(mapOrigins: readonly string[], https: boolean): RequestHandler {
  const options: HelmetOptions = {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'"],
        "img-src": ["'self'", "data:", "blob:", ...mapOrigins],
        "connect-src": ["'self'", ...mapOrigins],
        "worker-src": ["'self'", "blob:"],
        "child-src": ["'self'", "blob:"],
        "font-src": ["'self'"],
        "manifest-src": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'none'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
        ...(https ? { "upgrade-insecure-requests": [] } : {}),
      },
    },
    // Map tiles come from another origin without CORP headers: no COEP.
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-origin" },
    originAgentCluster: true,
    referrerPolicy: { policy: "same-origin" },
    xContentTypeOptions: true,
    xFrameOptions: { action: "deny" },
    strictTransportSecurity: https
      ? { maxAge: twoYearsInSeconds, includeSubDomains: true, preload: false }
      : false,
  };
  return helmet(options);
}

/**
 * Security headers of docs/architecture.md §12. HSTS and
 * `upgrade-insecure-requests` only make sense (and are only sent) on HTTPS —
 * plain HTTP on localhost/LAN must keep working.
 */
export function securityHeaders(mapOrigins: readonly string[]): RequestHandler {
  const secure = helmetFor(mapOrigins, true);
  const plain = helmetFor(mapOrigins, false);
  return (req, res, next) => {
    res.setHeader("Permissions-Policy", permissionsPolicy);
    (req.secure ? secure : plain)(req, res, next);
  };
}
