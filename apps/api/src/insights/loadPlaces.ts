import type { InsightsPlaces, PlaceName, PlaceSummary } from "@trail/contracts/insights";
import type { Executor } from "../db/database";
import type { DeviceAccess } from "../devices/deviceAccess";
import { hasPendingWork } from "../processing/processingQueue";
import {
  groupPlaces,
  type LocalDay,
  localDaysOf,
  type PlaceGroup,
  placeDays,
  placeLimit,
} from "./groupPlaces";
import { type InsightsScope, insightsScope } from "./insightsScope";
import { placeNames } from "./placeNames";
import { loadPlaceStays } from "./placeStays";

const iso = (ms: number): string => new Date(ms).toISOString();

/** A place as the answers have it: its time, visits, days and the span of them. */
export function placeSummaryOf(
  group: PlaceGroup,
  name: PlaceName,
  days: readonly LocalDay[],
  periodStartMs: number,
  periodEndMs: number,
): PlaceSummary {
  const first = group.visits[0]?.fromMs ?? periodStartMs;
  const last = group.visits.at(-1)?.toMs ?? periodStartMs;
  return {
    key: group.key,
    centre: group.centre,
    name,
    durationS: Math.round(group.durationMs / 1000),
    visits: group.visits.filter(
      (visit) => visit.startedMs >= periodStartMs && visit.startedMs < periodEndMs,
    ).length,
    days: placeDays(group, days).length,
    firstAt: iso(first),
    lastAt: iso(last),
  };
}

/** `GET /api/v1/insights/places`: the stops of the period added up by place. */
export async function loadPlaces(
  db: Executor,
  access: DeviceAccess & { user: { id: string; timezone: string } },
  query: {
    from?: string | undefined;
    to?: string | undefined;
    devices?: readonly string[] | undefined;
  },
  given?: InsightsScope,
): Promise<InsightsPlaces> {
  const scope = given ?? (await insightsScope(db, access, query));
  const period = { startMs: scope.start.getTime(), endMs: scope.end.getTime() };
  const stays = await loadPlaceStays(db, scope.deviceIds, period);
  const groups = groupPlaces(stays, period);
  const top = groups.slice(0, placeLimit);
  const rest = groups.slice(placeLimit);
  const names = await placeNames(db, top);
  const days = localDaysOf(scope.hours);
  const visitsOf = (group: PlaceGroup) =>
    group.visits.filter(
      (visit) => visit.startedMs >= period.startMs && visit.startedMs < period.endMs,
    ).length;
  const durationOf = (list: readonly PlaceGroup[]) =>
    Math.round(list.reduce((sum, group) => sum + group.durationMs, 0) / 1000);
  const visitsIn = (list: readonly PlaceGroup[]) =>
    list.reduce((sum, group) => sum + visitsOf(group), 0);
  return {
    timezone: scope.timezone,
    period: scope.period,
    totals: {
      places: groups.length,
      durationS: durationOf(groups),
      visits: visitsIn(groups),
    },
    places: top.map((group, index) =>
      placeSummaryOf(group, names[index] ?? null, days, period.startMs, period.endMs),
    ),
    rest: { places: rest.length, durationS: durationOf(rest), visits: visitsIn(rest) },
    pending: await hasPendingWork(db, scope.deviceIds, scope.start, scope.end),
  };
}
