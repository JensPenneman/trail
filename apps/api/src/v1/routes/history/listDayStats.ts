import { dayStatsQuerySchema, dayStatsResponseSchema } from "@trail/contracts/statsPublic";
import { findDayStats } from "../../../stats/findDayStats";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/stats/days` */
export const listDayStats = defineRoute(
  {
    method: "get",
    path: "/api/v1/stats/days",
    operationId: "listDayStats",
    summary: "List daily statistics",
    description:
      "Points, distance and the first and last point of every device on every local day from `from` to `to` (both included) that has points. Days follow the account's time zone, which the answer repeats. At most 400 days at once.",
    tags: ["History"],
    auth: { scopes: ["history:read"] },
    request: { query: dayStatsQuerySchema },
    // A device in `devices` that is unknown, foreign or outside the token is a 404.
    errors: [404],
    responses: { 200: dayStatsResponseSchema },
  },
  async ({ ctx, auth, query }) => ({
    status: 200,
    body: {
      timezone: auth.user.timezone,
      days: await findDayStats(ctx.db, auth, {
        from: query.from,
        to: query.to,
        deviceIds: query.devices,
      }),
    },
  }),
);
