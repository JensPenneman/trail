import type { Request } from "express";

/* What a request that matched no route is counted as: a fixed name for each
 * area, never a piece of its path, which may hold an id or a secret (a link's
 * token, a mistyped URL). */
const areas: readonly (readonly [prefix: string, name: string])[] = [
  ["/api/v1/", "/api/v1/*"],
  ["/api/", "/api/*"],
  ["/assets/", "/assets/*"],
  ["/mcp", "/mcp"],
  ["/docs", "/docs"],
];

/** The name of a path outside every route. */
export function areaOf(path: string): string {
  const lower = path.toLowerCase();
  for (const [prefix, name] of areas) {
    if (lower.startsWith(prefix) || `${lower}/` === prefix) return name;
  }
  return "/*";
}

/**
 * Follows the route a request matches, for its pattern (`/api/devices/:id`)
 * once it is answered. Express sets `req.route` when a route matches, while
 * `req.baseUrl` is still the path its router is mounted on (`/api/v1`); by
 * the time the answer is out, an error that left the router has reset
 * `baseUrl`, so the mount is taken at the moment the route is set. Returns
 * the pattern, or null while no route matched.
 */
export function followRoute(req: Request): () => string | null {
  let route: unknown;
  let mount = "";
  Object.defineProperty(req, "route", {
    configurable: true,
    enumerable: true,
    get: () => route,
    set: (value: unknown) => {
      route = value;
      mount = req.baseUrl;
    },
  });
  return () => {
    const path = (route as { path?: unknown } | undefined)?.path;
    if (typeof path !== "string") return null;
    const joined = path === "/" && mount !== "" ? mount : `${mount}${path}`;
    return joined === "" ? "/" : joined;
  };
}
