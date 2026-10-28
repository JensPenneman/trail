import type { QueryClient } from "@tanstack/react-query";
import type { ServerEvent } from "@trail/contracts/events";
import type { DayStat, DaysResponse } from "@trail/contracts/stats";
import type { SessionUser } from "@trail/contracts/user";
import { queryKeys } from "../api/queryKeys";
import { browserCacheOf } from "../cache/attachBrowserCache";
import { addDays } from "../time/addDays";
import { startOfLocalDay } from "../time/startOfLocalDay";
import { staleDaySlices } from "./staleDaySlices";

type DaysEvent = Extract<ServerEvent, { type: "days" }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isDaysResponse = (value: unknown): value is DaysResponse =>
  isRecord(value) && Array.isArray(value["days"]) && typeof value["timezone"] === "string";

/** The server's order: by date, then device. */
const byDateAndDevice = (a: DayStat, b: DayStat): number =>
  a.date === b.date ? (a.deviceId < b.deviceId ? -1 : 1) : a.date < b.date ? -1 : 1;

/** The answers that depend on a day's recorded data (the digest itself is updated in place). */
const recorded = new Set(["tracks", "level-tracks", "timeline", "visits", "trips"]);

/**
 * The daily statistics summed some of a device's days up again: every digest
 * in memory that covers them takes the rows the event carries in place of
 * its own — a named date without a row lost its last point — keeping when it
 * was fetched (the rest of it is no newer), and is kept on disk again; the
 * answers of those days go stale, and the ones on screen are asked for again
 * (with their ETag). No poll of `/api/stats/days` is needed for any of it.
 */
export function applyDaysEvent(client: QueryClient, event: DaysEvent): void {
  const timezone = client.getQueryData<SessionUser | null>(queryKeys.session)?.timezone ?? null;
  const cache = browserCacheOf(client);
  for (const query of client.getQueryCache().findAll({ queryKey: queryKeys.all.days })) {
    const data = query.state.data;
    const params = query.queryKey[1];
    if (!isDaysResponse(data) || !isRecord(params)) continue;
    if (timezone !== null && data.timezone !== timezone) continue;
    const { from, to, deviceIds } = params;
    if (typeof from !== "string" || typeof to !== "string") continue;
    if (Array.isArray(deviceIds) && !deviceIds.includes(event.deviceId)) continue;
    const named = new Set(event.dates.filter((date) => date >= from && date <= to));
    if (named.size === 0) continue;
    const days = [
      ...data.days.filter((row) => row.deviceId !== event.deviceId || !named.has(row.date)),
      ...event.days.filter((row) => row.deviceId === event.deviceId && named.has(row.date)),
    ].sort(byDateAndDevice);
    client.setQueryData<DaysResponse>(
      query.queryKey,
      { ...data, days },
      { updatedAt: query.state.dataUpdatedAt },
    );
    cache?.persistNow(query.queryKey);
  }
  if (timezone === null || event.dates.length === 0) return;
  void staleDaySlices(client, recorded, {
    deviceId: event.deviceId,
    spans: event.dates.map((date) => ({
      from: startOfLocalDay(date, timezone),
      to: startOfLocalDay(addDays(date, 1), timezone),
    })),
    timezone,
  });
}
