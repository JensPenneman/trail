import type { V1Route } from "../../defineRoute";
import { getActivity } from "./getActivity";
import { listDayStats } from "./listDayStats";
import { listTrips } from "./listTrips";

/** The history without coordinates, in the order of the reference: `history:read`. */
export const historyRoutes: readonly V1Route[] = [listTrips, listDayStats, getActivity];
