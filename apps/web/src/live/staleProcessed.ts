import type { QueryClient } from "@tanstack/react-query";
import type { SessionUser } from "@trail/contracts/user";
import { queryKeys } from "../api/queryKeys";
import { staleDaySlices } from "./staleDaySlices";

/**
 * What processing changes: the levels, the stops and moves, the period sums
 * of Insights — and the processed stamps of the calendar's digests. No `days`
 * event tells of those (the daily statistics stay as they were), so a digest
 * left fresh would vouch for the days' answers as they were (settledDay.ts),
 * and asking for them again would ask the server nothing: a digest covering
 * the change goes stale with them, and one on screen is fetched again, which
 * a past day's answer waits for before it compares stamps.
 */
const processed = new Set(["level-tracks", "timeline", "insights", "days"]);

/** A stretch of a device's history that processing changed, as the `segments` event names it. */
export interface ProcessedChange {
  deviceId: string;
  from: string;
  to: string;
}

/**
 * Processing changed `[from, to)` of a device (docs/architecture.md §9): a
 * window was worked out, or a mode corrected — the `segments` event, and the
 * page's own correction, which asks again without waiting for the event.
 * The answers covering it go stale, the ones on screen are asked for again,
 * and so is the device's current mode.
 */
export function staleProcessed(client: QueryClient, change: ProcessedChange): void {
  void staleDaySlices(client, processed, {
    deviceId: change.deviceId,
    spans: [{ from: Date.parse(change.from), to: Date.parse(change.to) }],
    timezone: client.getQueryData<SessionUser | null>(queryKeys.session)?.timezone ?? null,
  });
  void client.invalidateQueries({ queryKey: queryKeys.deviceMode(change.deviceId) });
}
