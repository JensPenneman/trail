import { HttpError } from "../http/httpError";

/**
 * Where a page of the data access log ends: the last line's hour and dedupe
 * key — the table's unique key after the owner, and nothing of its identity
 * column, whose gaps would tell how much other accounts are read.
 */
export interface AccessLogCursor {
  bucketStart: Date;
  dedupeKey: string;
}

const hourMs = 3_600_000;
const dedupeKeyPattern = /^[A-Za-z0-9_-]{43}$/;

/** A line's id: its hour (hours since 1970) and its dedupe key, `498630.4kVf…`. */
export const accessLineId = (bucketStart: Date, dedupeKey: string): string =>
  `${Math.floor(bucketStart.getTime() / hourMs)}.${dedupeKey}`;

/** An opaque cursor: base64url of `<bucketStart>|<dedupeKey>`. */
export const encodeAccessLogCursor = (cursor: AccessLogCursor): string =>
  Buffer.from(`${cursor.bucketStart.toISOString()}|${cursor.dedupeKey}`, "utf8").toString(
    "base64url",
  );

/** The cursor of a request, or 400 `validation_failed` naming `cursor`. */
export function decodeAccessLogCursor(value: string): AccessLogCursor {
  const [bucket = "", dedupeKey = "", ...rest] = Buffer.from(value, "base64url")
    .toString("utf8")
    .split("|");
  const bucketStart = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/.test(bucket)
    ? new Date(bucket)
    : null;
  if (
    rest.length > 0 ||
    bucketStart === null ||
    Number.isNaN(bucketStart.getTime()) ||
    !dedupeKeyPattern.test(dedupeKey)
  ) {
    throw new HttpError(
      400,
      "validation_failed",
      "Invalid request — cursor: not a cursor of this list",
      { cursor: ["Not a cursor of this list: pass the nextCursor of the previous page"] },
    );
  }
  return { bucketStart, dedupeKey };
}
