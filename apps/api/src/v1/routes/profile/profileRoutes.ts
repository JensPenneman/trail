import type { V1Route } from "../../defineRoute";
import { getMe } from "./getMe";

/** The profile operations, in the order of the reference. */
export const profileRoutes: readonly V1Route[] = [getMe];
