import { HttpError } from "../http/httpError";
import { isUuid } from "../lib/isUuid";

/** Where a timeline page ends: the last segment's start and device. */
export interface TimelineCursor {
  startedAt: string;
  deviceId: string;
}

/** An opaque cursor: base64url of `<startedAt>|<deviceId>`. */
export const encodeTimelineCursor = (cursor: TimelineCursor): string =>
  Buffer.from(`${cursor.startedAt}|${cursor.deviceId}`, "utf8").toString("base64url");

/** The cursor of a request, or 400 `validation_failed` naming `cursor`. */
export function decodeTimelineCursor(value: string): TimelineCursor {
  const [startedAt, deviceId, ...rest] = Buffer.from(value, "base64url")
    .toString("utf8")
    .split("|");
  if (
    rest.length > 0 ||
    startedAt === undefined ||
    deviceId === undefined ||
    !isUuid(deviceId) ||
    Number.isNaN(Date.parse(startedAt))
  ) {
    throw new HttpError(
      400,
      "validation_failed",
      "Invalid request — cursor: not a cursor of this list",
      {
        cursor: ["Not a cursor of this list"],
      },
    );
  }
  return { startedAt: new Date(startedAt).toISOString(), deviceId };
}
