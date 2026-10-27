import { parseIsoTimestamp } from "../ingest/parseIsoTimestamp";

/** A decimal number as the clients write them (`51.0543`, `-3.5`, `1e-3`); empty or anything else is null. */
const decimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function decimalOf(value: string | undefined): number | null {
  if (value === undefined) return null;
  const text = value.trim();
  if (!decimalPattern.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/** `true`/`1` and `false`/`0`, as Traccar reads them; anything else is null. */
export function booleanOf(value: string | undefined): boolean | null {
  const text = value?.trim().toLowerCase();
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  return null;
}

/*
 * Seconds and milliseconds since 1970 cannot be confused within the times
 * Trail takes (1990 until tomorrow): seconds stay below 1e11 until the year
 * 5138, milliseconds are above it since 1973.
 */
const millisecondsFrom = 1e11;

/**
 * The `timestamp` parameter: UNIX seconds (Traccar Client, OsmAnd's own
 * service), milliseconds (OsmAnd's {2}) or ISO 8601 with a zone (GPSLogger's
 * %TIME). Traccar's `yyyy-MM-dd HH:mm:ss` has no zone, so it is refused, as is
 * anything else.
 */
export function timestampOf(value: string): Date | null {
  const number = decimalOf(value);
  if (number !== null) {
    return number <= 0
      ? null
      : new Date(Math.round(number < millisecondsFrom ? number * 1000 : number));
  }
  return parseIsoTimestamp(value.trim());
}
