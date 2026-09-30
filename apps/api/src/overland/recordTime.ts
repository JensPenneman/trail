import { parseOverlandTimestamp } from "./parseOverlandTimestamp";

/** Records may be at most this far in the future (clock skew), otherwise they are rejected. */
const maxFutureMs = 24 * 3_600_000;

export type TimeResult = { ok: true; value: Date } | { ok: false; reason: string };

/** The record's `timestamp`, validated against the time the upload was received. */
export function recordTime(value: unknown, receivedAt: Date): TimeResult {
  if (value === undefined || value === null) return { ok: false, reason: "missing timestamp" };
  const time = parseOverlandTimestamp(value);
  if (time === null) return { ok: false, reason: "invalid timestamp" };
  if (time.getTime() > receivedAt.getTime() + maxFutureMs) {
    return { ok: false, reason: "timestamp is more than 24 h in the future" };
  }
  return { ok: true, value: time };
}
