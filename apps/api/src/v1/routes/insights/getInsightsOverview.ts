import { insightsOverviewSchema, insightsQuerySchema } from "@trail/contracts/insights";
import { loadInsightsOverview, overviewRange } from "../../../insights/loadInsightsOverview";
import { defineRoute } from "../../defineRoute";
import { answerInsights } from "./answerInsights";

/** `GET /api/v1/insights/overview` */
export const getInsightsOverview = defineRoute(
  {
    method: "get",
    path: "/api/v1/insights/overview",
    operationId: "getInsightsOverview",
    summary: "Get how you travelled",
    description:
      "Totals of a period of local days (the account's time zone; at most three years, the whole history up to today by default) — distance, time on the move, moves, stops and active days — with the same totals for the period of as many days just before, every transport mode's distance, time, moves, average speed and share with its change since that period, and a series per day, week or month (by the period's length: up to 31 days by day, up to 26 weeks by week, else by month) of distance and time per mode. A move across the period's edge counts with the part inside it, in proportion to its time, and so across midnight and the steps of the series; counts are of the moves and stops that started inside. `pending` is true while recorded points of the period still wait for processing.",
    tags: ["Insights"],
    auth: { scopes: ["history:read"] },
    request: { query: insightsQuerySchema },
    // A device in `devices` that is unknown, foreign or outside the token is a 404.
    errors: [404],
    responses: { 200: insightsOverviewSchema, 304: null },
  },
  ({ ctx, auth, query, ifNoneMatch }) =>
    answerInsights({
      ctx,
      auth,
      ifNoneMatch,
      operationId: "getInsightsOverview",
      asked: query,
      query,
      range: overviewRange,
      load: (scope) => loadInsightsOverview(ctx.db, auth, query, scope),
    }),
);
