import type { RequestHandler } from "express";
import { hasIngestDevice } from "./ingestDevice";
import { bearerChallenge, invalidTokenMessage, sendIngestError } from "./sendIngestError";

/** A missing or unknown device token is 401 in the ingest's error format. */
export function requireIngestDevice(
  challenges: readonly string[] = [bearerChallenge],
): RequestHandler {
  return (req, res, next) => {
    if (hasIngestDevice(req)) {
      next();
      return;
    }
    sendIngestError(res, 401, invalidTokenMessage, challenges);
  };
}
