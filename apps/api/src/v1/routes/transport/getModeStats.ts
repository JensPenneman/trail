import { modeStatsQuerySchema, modeStatsResponseSchema } from "@trail/contracts/transport";
import { loadModeStats } from "../../../transport/loadModeStats";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/stats/modes` */
export const getModeStats = defineRoute(
  {
    method: "get",
    path: "/api/v1/stats/modes",
    operationId: "getModeStats",
    summary: "Get distance and time per mode",
    description:
      "Per local day (the account's time zone) from `from` to `to` (inclusive, at most 400 days), device and transport mode: the distance, the time and the number of segments, and how many of those a person set. Stops count as `stationary`; a segment across midnight counts on both days in proportion to its time.",
    tags: ["Timeline"],
    auth: { scopes: ["history:read"] },
    request: { query: modeStatsQuerySchema },
    responses: { 200: modeStatsResponseSchema },
  },
  async ({ ctx, auth, query }) => ({
    status: 200,
    body: await loadModeStats(ctx.db, auth, query),
  }),
);
