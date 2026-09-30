import type { RequestHandler } from "express";
import { hasIngestDevice } from "./ingestDevice";
import { invalidTokenMessage, sendOverlandError } from "./sendOverlandError";

/** A missing or unknown device token is 401 in Overland's error format. */
export const requireIngestDevice: RequestHandler = (req, res, next) => {
  if (hasIngestDevice(req)) {
    next();
    return;
  }
  sendOverlandError(res, 401, invalidTokenMessage);
};
