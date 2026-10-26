import type { V1Route } from "../../defineRoute";
import { getHeatmap } from "./getHeatmap";
import { listLocations } from "./listLocations";
import { listVisits } from "./listVisits";

/** The operations with coordinates, in the order of the reference: all need `locations:read`. */
export const locationRoutes: readonly V1Route[] = [listLocations, listVisits, getHeatmap];
