import type { Response } from "express";

/** Overland shows `{"error": "…"}` to the user and keeps (retries) its queued batch. */
export function sendOverlandError(res: Response, status: number, message: string): void {
  if (status === 401) res.setHeader("WWW-Authenticate", 'Bearer realm="trail"');
  res.status(status).json({ error: message });
}

export const invalidTokenMessage = "Invalid access token";
