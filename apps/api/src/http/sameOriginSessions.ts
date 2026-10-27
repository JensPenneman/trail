import type { RequestHandler } from "express";
import { getRequestAuth } from "../auth/requestAuth";
import { HttpError } from "./httpError";

/* What a browser says of a request's initiator: Trail's own page, or nobody
 * (an address typed, a bookmark). A client that is no browser sends nothing. */
const ownPages = new Set(["same-origin", "none"]);

/**
 * A signed-in browser reaches the API from Trail's own pages only
 * (docs/architecture.md §7): a request the session cookie authenticates is
 * refused, whatever its method, when its `Sec-Fetch-Site` names another site
 * or a sibling one. A link or an image on another page sends a GET with the
 * cookie and no Origin, which the CSRF guard lets through — and which could
 * otherwise make a person "look" at someone in that person's data access
 * log. API tokens are no ambient credential and pass, from anywhere.
 */
export const sameOriginSessions: RequestHandler = (req, _res, next) => {
  const site = req.get("sec-fetch-site");
  if (site !== undefined && !ownPages.has(site) && getRequestAuth(req)?.kind === "session") {
    throw new HttpError(
      403,
      "origin_not_allowed",
      "A signed-in browser can use the API from Trail's own pages only.",
    );
  }
  next();
};
