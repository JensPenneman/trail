import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import express, { type Router } from "express";
import type { Logger } from "pino";

const notFoundText = (res: express.Response): void => {
  res.status(404).type("text/plain").send("Not found.");
};

/**
 * Serves the built SPA: hashed `/assets/*` are immutable for a year, every other
 * file and `index.html` must revalidate, and client-side routes (paths without
 * a file extension) get `index.html`. A missing build directory means API only.
 */
export function spaRouter(webDistDir: string, logger: Logger): Router | null {
  const indexPath = join(webDistDir, "index.html");
  if (!existsSync(indexPath)) {
    logger.info({ webDistDir }, "no built web app found — serving the API only");
    return null;
  }
  const router = express.Router();
  router.use(
    "/assets",
    express.static(join(webDistDir, "assets"), {
      immutable: true,
      maxAge: "1y",
      index: false,
      redirect: false,
    }),
  );
  router.use("/assets", (_req, res) => notFoundText(res));
  router.use(
    express.static(webDistDir, {
      index: false,
      redirect: false,
      setHeaders: (res) => {
        res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );
  router.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (extname(req.path) !== "") {
      notFoundText(res);
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexPath, (error) => {
      if (error !== undefined) next(error);
    });
  });
  return router;
}
