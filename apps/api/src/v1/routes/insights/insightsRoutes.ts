import type { V1Route } from "../../defineRoute";
import { getInsightsMode } from "./getInsightsMode";
import { getInsightsOverview } from "./getInsightsOverview";
import { getInsightsRoads } from "./getInsightsRoads";
import { getInsightsTime } from "./getInsightsTime";

/** Statistics of how the owner travelled, in the order of the reference. */
export const insightsRoutes: readonly V1Route[] = [
  getInsightsOverview,
  getInsightsMode,
  getInsightsTime,
  getInsightsRoads,
];
