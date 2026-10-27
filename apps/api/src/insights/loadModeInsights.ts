import type { InsightsMode } from "@trail/contracts/insights";
import type { TransportMode } from "@trail/contracts/transport";
import type { Executor } from "../db/database";
import type { DeviceAccess } from "../devices/deviceAccess";
import { hasPendingWork } from "../processing/processingQueue";
import { buildModeInsights } from "./buildModeInsights";
import { loadInsightMoves } from "./insightMoves";
import { bucketFor } from "./insightsPeriod";
import { insightsScope } from "./insightsScope";

/** `GET /api/v1/insights/modes/{mode}` */
export async function loadModeInsights(
  db: Executor,
  access: DeviceAccess & { user: { id: string; timezone: string } },
  mode: TransportMode,
  query: {
    from?: string | undefined;
    to?: string | undefined;
    devices?: readonly string[] | undefined;
  },
): Promise<InsightsMode> {
  const scope = await insightsScope(db, access, query);
  const range = { startMs: scope.start.getTime(), endMs: scope.end.getTime() };
  const moves = await loadInsightMoves(db, scope.deviceIds, range, mode);
  return buildModeInsights({
    timezone: scope.timezone,
    mode,
    period: scope.period,
    bucket: bucketFor(scope.period.days),
    hours: scope.hours,
    moves,
    pending: await hasPendingWork(db, scope.deviceIds, scope.start, scope.end),
  });
}
