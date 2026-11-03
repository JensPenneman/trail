import type { RequestHandler } from "express";
import helmet, { type HelmetOptions } from "helmet";
import { permissionsPolicy } from "./permissionsPolicy";

const twoYearsInSeconds = 63_072_000;

/** The CSP of docs/architecture.md §12; `mapOrigins` are the map's outside tile and style servers. */
export function contentSecurityPolicyDirectives(
  mapOrigins: readonly string[],
  https: boolean,
): Record<string, string[]> {
  return {
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
  };
}

function helmetFor(mapOrigins: readonly string[], https: boolean): RequestHandler {
  const options: HelmetOptions = {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: contentSecurityPolicyDirectives(mapOrigins, https),
    },
    // Satellite imagery and the external styles come from other origins without CORP headers: no COEP.
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
 * plain HTTP on localhost/LAN must keep working. The map's origins come from
 * the configuration alone, never from what the basemap serves at the moment
 * (a build can arrive or vanish while a page is open): `mapOrigins.external`
 * when the external styles can be used at all (`externalStyles`: the
 * fallback is on, or the basemap is OpenFreeMap), else `mapOrigins.self`.
 * Both start from `'self'`.
 */
export function securityHeaders(
  mapOrigins: { self: readonly string[]; external: readonly string[] },
  externalStyles: boolean,
): RequestHandler {
  const origins = externalStyles ? mapOrigins.external : mapOrigins.self;
  const secure = helmetFor(origins, true);
  const plain = helmetFor(origins, false);
  return (req, res, next) => {
    res.setHeader("Permissions-Policy", permissionsPolicy);
    (req.secure ? secure : plain)(req, res, next);
  };
}
