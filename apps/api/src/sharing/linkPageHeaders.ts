import type { RequestHandler } from "express";

/**
 * For the page of a public link and its data (`/s/…`, `/api/public/shares/…`):
 * the secret is part of the address, so it never travels on as a referrer,
 * and search engines are asked to keep the pages out of their index.
 */
export const linkPageHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
};
