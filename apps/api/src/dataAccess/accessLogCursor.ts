import { HttpError } from "../http/httpError";

/** Where a page of the data access log ends: the last line's hour and id. */
export interface AccessLogCursor {
  bucketStart: Date;
  id: number;
}

/** An opaque cursor: base64url of `<bucketStart>|<id>`. */
export const encodeAccessLogCursor = (cursor: AccessLogCursor): string =>
  Buffer.from(`${cursor.bucketStart.toISOString()}|${cursor.id}`, "utf8").toString("base64url");

/** The cursor of a request, or 400 `validation_failed` naming `cursor`. */
export function decodeAccessLogCursor(value: string): AccessLogCursor {
  const [bucket = "", id = "", ...rest] = Buffer.from(value, "base64url")
    .toString("utf8")
    .split("|");
  const bucketStart = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/.test(bucket)
    ? new Date(bucket)
    : null;
  const number = /^\d{1,15}$/.test(id) ? Number(id) : Number.NaN;
  if (
    rest.length > 0 ||
    bucketStart === null ||
    Number.isNaN(bucketStart.getTime()) ||
    !Number.isSafeInteger(number)
  ) {
    throw new HttpError(
      400,
      "validation_failed",
      "Invalid request — cursor: not a cursor of this list",
      { cursor: ["Not a cursor of this list: pass the nextCursor of the previous page"] },
    );
  }
  return { bucketStart, id: number };
}
