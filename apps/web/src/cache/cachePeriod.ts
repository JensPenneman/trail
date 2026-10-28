import { addDays } from "../time/addDays";
import { localDateOf } from "../time/localDateOf";
import { startOfLocalDay } from "../time/startOfLocalDay";

/** The period an answer covers: `[from, until)` in epoch ms, and its local date when it is one day. */
export interface CachePeriod {
  from: number;
  until: number;
  /** The local date when the period is exactly that day; null for a longer or shorter one. */
  day: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const localDate = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The period of a query key: the instants of the day-sliced answers (`tracks`,
 * `level-tracks`, `timeline`, `visits`, `trips`) and the local dates of the
 * calendar's digest (`days`, inclusive). Null for anything else.
 */
export function periodOf(queryKey: readonly unknown[], timeZone: string): CachePeriod | null {
  const params = queryKey[1];
  if (!isRecord(params)) return null;
  const { from, to } = params;
  if (typeof from !== "string" || typeof to !== "string") return null;
  try {
    if (queryKey[0] === "days") {
      if (!localDate.test(from) || !localDate.test(to)) return null;
      return {
        from: startOfLocalDay(from, timeZone),
        until: startOfLocalDay(addDays(to, 1), timeZone),
        day: from === to ? from : null,
      };
    }
    const start = Date.parse(from);
    const end = Date.parse(to);
    if (Number.isNaN(start) || Number.isNaN(end)) return null;
    const date = localDateOf(start, timeZone);
    const oneDay =
      startOfLocalDay(date, timeZone) === start &&
      startOfLocalDay(addDays(date, 1), timeZone) === end;
    return { from: start, until: end, day: oneDay ? date : null };
  } catch {
    // a zone the browser does not know, or a date that is none
    return null;
  }
}

/** The devices a query key covers: the ones it names, null for all of the owner's. */
export function devicesOf(queryKey: readonly unknown[]): readonly string[] | null {
  const resource = queryKey[0];
  if (resource === "device-mode" || resource === "ingest-log") {
    return typeof queryKey[1] === "string" ? [queryKey[1]] : null;
  }
  const params = queryKey.find(isRecord);
  const ids = params?.["deviceIds"];
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : null;
}
