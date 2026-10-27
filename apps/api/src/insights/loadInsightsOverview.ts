import type { InsightsOverview } from "@trail/contracts/insights";
import type { Executor } from "../db/database";
import type { DeviceAccess } from "../devices/deviceAccess";
import { hasPendingWork } from "../processing/processingQueue";
import { buildOverview } from "./buildOverview";
import { countStops, loadInsightMoves } from "./insightMoves";
import { bucketFor, previousPeriod } from "./insightsPeriod";
import { insightsScope } from "./insightsScope";
import { localHours } from "./localHours";

/** `GET /api/v1/insights/overview`: the period and the one before it, in one read of the segments. */
export async function loadInsightsOverview(
  db: Executor,
  access: DeviceAccess & { user: { id: string; timezone: string } },
  query: {
    from?: string | undefined;
    to?: string | undefined;
    devices?: readonly string[] | undefined;
  },
): Promise<InsightsOverview> {
  const scope = await insightsScope(db, access, query);
  const previous = previousPeriod(scope.period);
  const previousHours = localHours(previous.from, previous.to, scope.timezone);
  const previousStart = previousHours[0]?.start ?? scope.start.getTime();
  const range = { startMs: scope.start.getTime(), endMs: scope.end.getTime() };
  const moves = await loadInsightMoves(db, scope.deviceIds, {
    startMs: previousStart,
    endMs: range.endMs,
  });
  const [current = 0, before = 0] = await countStops(db, scope.deviceIds, [
    range,
    { startMs: previousStart, endMs: range.startMs },
  ]);
  return buildOverview({
    timezone: scope.timezone,
    period: scope.period,
    bucket: bucketFor(scope.period.days),
    previous,
    hours: scope.hours,
    previousHours,
    moves,
    stops: { current, previous: before },
    pending: await hasPendingWork(db, scope.deviceIds, scope.start, scope.end),
  });
}
