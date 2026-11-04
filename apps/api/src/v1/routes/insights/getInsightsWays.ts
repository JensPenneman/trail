import { insightsModeFilterQuerySchema, insightsWaysSchema } from "@trail/contracts/insights";
import { loadMoveWays } from "../../../insights/loadMoveWays";
import { loadWays, mapStamp } from "../../../insights/loadWays";
import { defineRoute } from "../../defineRoute";
import { answerInsights } from "./answerInsights";

/** `GET /api/v1/insights/ways` */
export const getInsightsWays = defineRoute(
  {
    method: "get",
    path: "/api/v1/insights/ways",
    operationId: "getInsightsWays",
    summary: "Get the named roads you travelled",
    description:
      "The roads you travelled most over a period of local days, for one transport mode or all of them, by the name OpenStreetMap gives them: ways of one name that lie together are one road, the same name in another town another. Each road has the distance, its share of the distance on named roads and the rough position of its centre (three decimals), so it needs `locations:read`. Moves without map data, or not worked out again yet after an upgrade, count towards `distanceM` only.",
    tags: ["Insights"],
    auth: { scopes: ["locations:read"] },
    request: { query: insightsModeFilterQuerySchema },
    // A device in `devices` that is unknown, foreign or outside the token is a 404.
    errors: [404],
    responses: { 200: insightsWaysSchema, 304: null },
  },
  ({ ctx, auth, query, ifNoneMatch }) =>
    answerInsights({
      ctx,
      auth,
      ifNoneMatch,
      operationId: "getInsightsWays",
      asked: query,
      query,
      extra: () => mapStamp(ctx.db),
      load: async (scope) =>
        loadWays(
          ctx.db,
          scope,
          query.mode ?? null,
          await loadMoveWays(
            ctx.db,
            scope.deviceIds,
            { startMs: scope.start.getTime(), endMs: scope.end.getTime() },
            query.mode ?? null,
          ),
        ),
    }),
);
