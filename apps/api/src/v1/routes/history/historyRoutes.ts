import type { V1Route } from "../../defineRoute";
import { getActivity } from "./getActivity";
import { getHeatmap } from "./getHeatmap";
import { listDayStats } from "./listDayStats";
import { listTrips } from "./listTrips";
import { listVisits } from "./listVisits";

/** The history operations, in the order of the reference. */
export const historyRoutes: readonly V1Route[] = [
  listVisits,
  listTrips,
  listDayStats,
  getActivity,
  getHeatmap,
];
