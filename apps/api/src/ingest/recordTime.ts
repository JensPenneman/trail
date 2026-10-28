import { parseIsoTimestamp } from "./parseIsoTimestamp";

/** Records may be at most this far in the future (clock skew), otherwise they are rejected. */
const maxFutureMs = 24 * 3_600_000;

/*
 * Older is no GPS fix of a phone running a tracking app but a reset clock or
 * iOS's `distantPast` (0001-01-01) — and year 0000, which the timestamp format
 * allows, is not even a date Postgres can store.
 */
const earliest = Date.UTC(1990, 0, 1);

export type TimeResult = { ok: true; value: Date } | { ok: false; reason: string };

/** A record's time, validated against the time the upload was received. */
export function checkRecordTime(time: Date, receivedAt: Date): TimeResult {
  if (Number.isNaN(time.getTime())) return { ok: false, reason: "invalid timestamp" };
  if (time.getTime() > receivedAt.getTime() + maxFutureMs) {
    return { ok: false, reason: "timestamp is more than 24 h in the future" };
  }
  if (time.getTime() < earliest) return { ok: false, reason: "timestamp is before 1990" };
  return { ok: true, value: time };
}

/** The record's ISO 8601 `timestamp`, validated against the time the upload was received. */
export function recordTime(value: unknown, receivedAt: Date): TimeResult {
  if (value === undefined || value === null) return { ok: false, reason: "missing timestamp" };
  const time = parseIsoTimestamp(value);
  if (time === null) return { ok: false, reason: "invalid timestamp" };
  return checkRecordTime(time, receivedAt);
}
