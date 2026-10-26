import type { RequestHandler } from "express";

/**
 * For the page of a public link and its data (`/s`, `/api/public/share`): no
 * referrer leaves the page, and search engines are asked to keep both out of
 * their index. (The secret itself is in the fragment and a header, never in a
 * URL a server sees.)
 */
export const linkPageHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
};
