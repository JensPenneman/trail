import type { RequestHandler } from "express";
import { notFound } from "./httpError";
import { sendApiError } from "./sendApiError";

/** Unknown `/api` routes answer in JSON, never with the SPA's index.html. */
export const apiNotFound: RequestHandler = (_req, res) => {
  sendApiError(res, notFound("No such API route."));
};
