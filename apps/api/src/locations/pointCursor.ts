import { HttpError } from "../http/httpError";

/*
 * v1 cursors are opaque to clients: today the recorded time of a page's last
 * point, base64url-encoded, so the format can change without breaking anyone
 * who only passes `nextCursor` back.
 */

export function encodePointCursor(recordedAt: Date): string {
  return Buffer.from(recordedAt.toISOString(), "utf8").toString("base64url");
}

/** The instant a cursor stands for; a cursor this API did not hand out is a 400. */
export function decodePointCursor(cursor: string): Date {
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text)
    ? new Date(text)
    : null;
  if (instant === null || Number.isNaN(instant.getTime())) {
    throw new HttpError(
      400,
      "validation_failed",
      "Invalid request — cursor: Not a cursor of this API",
      {
        cursor: ["Not a cursor of this API: pass the nextCursor of the previous page"],
      },
    );
  }
  return instant;
}
