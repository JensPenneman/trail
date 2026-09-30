import type { RequestHandler } from "express";

/** API responses are personal and live: never cache them (docs/architecture.md §8). */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
};
