import type { InsightsPlace } from "@trail/contracts/insights";
import type { Executor } from "../db/database";
import type { DeviceAccess } from "../devices/deviceAccess";
import { hasPendingWork } from "../processing/processingQueue";
import { groupPlaces, localDaysOf, placeDays, placeOf } from "./groupPlaces";
import { bucketFor, bucketOf, bucketsOf } from "./insightsPeriod";
import { type InsightsScope, insightsScope } from "./insightsScope";
import { placeSummaryOf } from "./loadPlaces";
import { placeNames } from "./placeNames";
import { loadPlaceStays } from "./placeStays";

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * `GET /api/v1/insights/place`: one place over a period. The place is found
 * among the period's own places (a cell folded into a neighbour's resolves to
 * it), so the key asked for is never turned into anything but a lookup.
 */
export async function loadPlace(
  db: Executor,
  access: DeviceAccess & { user: { id: string; timezone: string } },
  query: {
    place: string;
    from?: string | undefined;
    to?: string | undefined;
    devices?: readonly string[] | undefined;
  },
  given?: InsightsScope,
): Promise<InsightsPlace> {
  const scope = given ?? (await insightsScope(db, access, query));
  const period = { startMs: scope.start.getTime(), endMs: scope.end.getTime() };
  const bucket = bucketFor(scope.period.days);
  const buckets = bucketsOf(scope.period, bucket);
  const stays = await loadPlaceStays(db, scope.deviceIds, period);
  const group = placeOf(groupPlaces(stays, period), query.place);
  const base = {
    timezone: scope.timezone,
    period: { ...scope.period, bucket, buckets },
    pending: await hasPendingWork(db, scope.deviceIds, scope.start, scope.end),
  };
  if (group === null) {
    return {
      ...base,
      place: null,
      series: buckets.map((step) => ({ bucket: step, durationS: 0, visits: 0 })),
      days: [],
    };
  }
  const localDays = localDaysOf(scope.hours);
  const [name] = await placeNames(db, [group]);
  const rows = placeDays(group, localDays);
  const steps = new Map<string, { durationMs: number; visits: number }>();
  for (const row of rows) {
    const key = bucketOf(row.date, bucket);
    const step = steps.get(key) ?? { durationMs: 0, visits: 0 };
    step.durationMs += row.durationMs;
    step.visits += row.visits;
    steps.set(key, step);
  }
  return {
    ...base,
    place: {
      ...placeSummaryOf(group, name ?? null, localDays, period.startMs, period.endMs),
      cells: group.cells.length,
    },
    series: buckets.map((step) => ({
      bucket: step,
      durationS: Math.round((steps.get(step)?.durationMs ?? 0) / 1000),
      visits: steps.get(step)?.visits ?? 0,
    })),
    days: rows
      .map((row) => ({
        date: row.date,
        durationS: Math.round(row.durationMs / 1000),
        visits: row.visits,
        firstAt: iso(row.firstMs),
        lastAt: iso(row.lastMs),
      }))
      .reverse(),
  };
}
