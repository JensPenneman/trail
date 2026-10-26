import type { V1Route } from "../../defineRoute";
import { listLocations } from "./listLocations";

/** The location operations, in the order of the reference. */
export const locationRoutes: readonly V1Route[] = [listLocations];
