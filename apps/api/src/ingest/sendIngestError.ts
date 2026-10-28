import type { Response } from "express";

/**
 * The error body of every ingest endpoint, `{"error": "…"}`: Overland shows it
 * to the user; OwnTracks, Traccar Client, OsmAnd and GPSLogger only look at the
 * status. A 401 names the schemes the endpoint takes.
 */
export function sendIngestError(
  res: Response,
  status: number,
  message: string,
  challenges: readonly string[] = [bearerChallenge],
): void {
  if (status === 401) res.setHeader("WWW-Authenticate", [...challenges]);
  res.status(status).json({ error: message });
}

export const bearerChallenge = 'Bearer realm="trail"';
export const basicChallenge = 'Basic realm="trail", charset="UTF-8"';

export const invalidTokenMessage = "Invalid access token";
