import type { Query, QueryClient } from "@tanstack/react-query";
import { localDateOf } from "../time/localDateOf";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether a query key covers the device: it names it, or every device. */
function coversDevice(params: Record<string, unknown>, deviceId: string): boolean {
  const ids = params["deviceIds"];
  return ids === null || ids === undefined || (Array.isArray(ids) && ids.includes(deviceId));
}

/** The query key's parameters, wherever in the key they are (`["insights", "mode", "car", params]`). */
const paramsOf = (query: Query): Record<string, unknown> | undefined =>
  query.queryKey.find(isRecord);

/** A stretch of time a change touched, `[from, to)` in epoch ms. */
export interface Span {
  from: number;
  to: number;
}

/** Resources whose keys hold local dates (`from` and `to` inclusive) rather than instants. */
const keyedByDate = new Set(["insights", "days"]);

/**
 * Marks stale the answers of `resources` that cover the device and overlap
 * one of the spans — ranges of instants, or local dates (Insights, with an
 * open end for "until today", and the calendar's digests) — and refetches
 * those on screen. What a change names is all that is asked for again, not
 * every level track in memory.
 */
export function staleDaySlices(
  client: QueryClient,
  resources: ReadonlySet<string>,
  change: { deviceId: string; spans: readonly Span[]; timezone: string | null },
): Promise<void> {
  const { timezone } = change;
  const localSpans =
    timezone === null
      ? null
      : change.spans.map((span) => ({
          first: localDateOf(span.from, timezone),
          last: localDateOf(Math.max(span.from, span.to - 1), timezone),
        }));
  return client.invalidateQueries({
    predicate: (query) => {
      const resource = query.queryKey[0];
      if (typeof resource !== "string" || !resources.has(resource)) return false;
      const params = paramsOf(query);
      if (params === undefined || !coversDevice(params, change.deviceId)) return false;
      const { from, to } = params;
      if (keyedByDate.has(resource)) {
        // Local dates, either end open; without a zone nothing can be ruled out.
        if (localSpans === null) return true;
        return localSpans.some(
          (span) =>
            (typeof to !== "string" || to >= span.first) &&
            (typeof from !== "string" || from <= span.last),
        );
      }
      if (typeof from !== "string" || typeof to !== "string") return false;
      const start = Date.parse(from);
      const end = Date.parse(to);
      return change.spans.some((span) => start < span.to && end > span.from);
    },
  });
}
