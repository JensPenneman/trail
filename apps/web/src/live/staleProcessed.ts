import type { QueryClient } from "@tanstack/react-query";
import type { SessionUser } from "@trail/contracts/user";
import { queryKeys } from "../api/queryKeys";
import { staleDaySlices } from "./staleDaySlices";

/** What processing changes: the levels, the stops and moves, the period sums of Insights. */
const processed = new Set(["level-tracks", "timeline", "insights"]);

/**
 * And the processed stamps of the calendar's digests. No `days` event tells
 * of those (the daily statistics stay as they were), so a digest left fresh
 * would vouch for the days' answers as they were (settledDay.ts), and asking
 * for them again would ask the server nothing: a digest covering the change
 * goes stale too, and one on screen is fetched again — first, so that a past
 * day's answer waits for that fetch rather than starting one of its own,
 * which the digest's refetch would cancel and send again.
 */
const digests = new Set(["days"]);

/** A stretch of a device's history that processing changed, as the `segments` event names it. */
export interface ProcessedChange {
  deviceId: string;
  from: string;
  to: string;
}

/** Who tells of a change: the answer to a correction made on this page, or a `segments` event. */
type Teller = "correction" | "event";

/** A correction's answer and the server's event for it come this close together, or not at all. */
const pairWithinMs = 5_000;

/** Changes one side told of whose other side has not come yet, per query client. */
const unpaired = new WeakMap<QueryClient, Map<string, Record<Teller, number> & { at: number }>>();

/**
 * Whether this is the second telling of a change. A correction made on this
 * page is told twice — by its answer and by the `segments` event the server
 * sends every open page, this one too — in either order, and both after the
 * change was stored: the first marks its answers stale and asks again; the
 * second would only cancel those requests and send them anew.
 */
function toldBefore(client: QueryClient, change: ProcessedChange, by: Teller): boolean {
  const now = Date.now();
  let told = unpaired.get(client);
  if (told === undefined) {
    told = new Map();
    unpaired.set(client, told);
  }
  for (const [key, entry] of told) if (now - entry.at > pairWithinMs) told.delete(key);
  const key = `${change.deviceId}|${Date.parse(change.from)}|${Date.parse(change.to)}`;
  const entry = told.get(key) ?? { correction: 0, event: 0, at: now };
  const other: Teller = by === "correction" ? "event" : "correction";
  if (entry[other] > 0) {
    entry[other] -= 1;
    if (entry.correction === 0 && entry.event === 0) told.delete(key);
    return true;
  }
  entry[by] += 1;
  entry.at = now;
  told.set(key, entry);
  return false;
}

/**
 * Processing changed `[from, to)` of a device (docs/architecture.md §9): a
 * window was worked out, or a mode corrected — the `segments` event, and the
 * page's own correction, which asks again without waiting for the event.
 * The answers covering it go stale, the ones on screen are asked for again,
 * and so is the device's current mode; once per change, however it was told.
 */
export function staleProcessed(client: QueryClient, change: ProcessedChange, by: Teller): void {
  if (toldBefore(client, change, by)) return;
  const slice = {
    deviceId: change.deviceId,
    spans: [{ from: Date.parse(change.from), to: Date.parse(change.to) }],
    timezone: client.getQueryData<SessionUser | null>(queryKeys.session)?.timezone ?? null,
  };
  void staleDaySlices(client, digests, slice);
  void staleDaySlices(client, processed, slice);
  void client.invalidateQueries({ queryKey: queryKeys.deviceMode(change.deviceId) });
}
