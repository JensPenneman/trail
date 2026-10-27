import { insightsModeFilterQuerySchema, insightsTimeSchema } from "@trail/contracts/insights";
import { loadTimeInsights } from "../../../insights/loadTimeInsights";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/insights/time` */
export const getInsightsTime = defineRoute(
  {
    method: "get",
    path: "/api/v1/insights/time",
    operationId: "getInsightsTime",
    summary: "Get when you travel",
    description:
      "Time and distance on the move in every hour of every day of the week (168 cells, local time) over a period of local days, for one transport mode or all of them, with the modes moved in during the period. Moves count in each hour in proportion to their time there; an hour that a change of the clocks repeats counts twice, one it skips not at all.",
    tags: ["Insights"],
    auth: { scopes: ["history:read"] },
    request: { query: insightsModeFilterQuerySchema },
    // A device in `devices` that is unknown, foreign or outside the token is a 404.
    errors: [404],
    responses: { 200: insightsTimeSchema },
  },
  async ({ ctx, auth, query }) => ({
    status: 200,
    body: await loadTimeInsights(ctx.db, auth, query),
  }),
);
