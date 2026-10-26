import express, { type RequestHandler, type Router } from "express";
import helmet from "helmet";
import type { Logger } from "pino";
import { contentSecurityPolicyDirectives } from "../http/securityHeaders";
import { apiReferencePage } from "./apiReferencePage";
import { type ApiReferenceScripts, apiReferenceScripts } from "./apiReferenceScripts";

const notFoundText = (res: express.Response): void => {
  res.status(404).type("text/plain").send("Not found.");
};

/* The reference renders its styles at runtime into <style> elements, so this
 * page — and only this page — allows inline styles. Scripts stay 'self'. */
function pageCsp(https: boolean): RequestHandler {
  const directives = contentSecurityPolicyDirectives([], https);
  return helmet.contentSecurityPolicy({
    useDefaults: false,
    directives: { ...directives, "style-src": ["'self'", "'unsafe-inline'"] },
  });
}

/**
 * `/docs` — the API reference (Scalar's standalone bundle from the image, never
 * from a CDN) rendering `/api/v1/openapi.json`. The bundle is read here, at
 * startup, and kept in memory with its ETag, so no request waits for 4.6 MB
 * from the disk. The page revalidates; its scripts carry their hash and are
 * immutable. Mounted before the SPA router, behind the per-IP limiter. Null
 * when the bundle is missing or unreadable (a broken build): the server runs
 * without the page.
 */
export function apiReferenceRouter(bundlePath: string | null, logger: Logger): Router | null {
  if (bundlePath === null) {
    logger.warn("the API reference bundle is missing — /docs is not served");
    return null;
  }
  let scripts: ApiReferenceScripts;
  try {
    scripts = apiReferenceScripts(bundlePath);
  } catch (error) {
    logger.warn({ err: error }, "the API reference bundle cannot be read — /docs is not served");
    return null;
  }
  const html = apiReferencePage(scripts.ordered);
  const secureCsp = pageCsp(true);
  const plainCsp = pageCsp(false);
  const router = express.Router();

  router.get("/", (req, res, next) => {
    (req.secure ? secureCsp : plainCsp)(req, res, (error?: unknown) => {
      if (error !== undefined) {
        next(error);
        return;
      }
      res.setHeader("Cache-Control", "no-cache");
      res.type("html").send(html);
    });
  });

  router.get("/assets/:name", async (req, res) => {
    const script = scripts.byName.get(req.params.name);
    if (script === undefined) {
      notFoundText(res);
      return;
    }
    await script.send(req, res);
  });

  router.use((_req, res) => notFoundText(res));
  return router;
}
