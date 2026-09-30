import type { RequestHandler } from "express";

/** Anything that is neither an API route nor part of the SPA. */
export const pageNotFound: RequestHandler = (_req, res) => {
  res.status(404).type("text/plain").send("Not found.");
};
