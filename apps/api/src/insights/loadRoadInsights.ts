import type { InsightsRoads } from "@trail/contracts/insights";
import type { TransportMode } from "@trail/contracts/transport";
import type { Executor } from "../db/database";
import type { DeviceAccess } from "../devices/deviceAccess";
import { hasPendingWork } from "../processing/processingQueue";
import { buildRoads } from "./buildRoads";
import { loadInsightMoves } from "./insightMoves";
import { type InsightsScope, insightsScope } from "./insightsScope";

/** `GET /api/v1/insights/roads`: every mode's moves are read, for the list of modes present. */
export async function loadRoadInsights(
  db: Executor,
  access: DeviceAccess & { user: { id: string; timezone: string } },
  query: {
    from?: string | undefined;
    to?: string | undefined;
    devices?: readonly string[] | undefined;
    mode?: TransportMode | undefined;
  },
  given?: InsightsScope,
): Promise<InsightsRoads> {
  const scope = given ?? (await insightsScope(db, access, query));
  const moves = await loadInsightMoves(db, scope.deviceIds, {
    startMs: scope.start.getTime(),
    endMs: scope.end.getTime(),
  });
  return buildRoads({
    timezone: scope.timezone,
    period: scope.period,
    mode: query.mode ?? null,
    hours: scope.hours,
    moves,
    pending: await hasPendingWork(db, scope.deviceIds, scope.start, scope.end),
  });
}
