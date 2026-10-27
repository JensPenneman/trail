import type { V1Route } from "../../defineRoute";
import { getAccessLogSummary } from "./getAccessLogSummary";
import { listAccessLog } from "./listAccessLog";

/** The data access log of the caller's account, in the order of the reference: `audit:read`. */
export const accessLogRoutes: readonly V1Route[] = [getAccessLogSummary, listAccessLog];
