import { insightsModeFilterQuerySchema, insightsWaysSchema } from "@trail/contracts/insights";
import { countMovesLacking, loadMoveWays } from "../../../insights/loadMoveWays";
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
      "The 25 roads you travelled most over a period of local days, for one transport mode or all of them, by the name OpenStreetMap gives them, with the distance and the number of moves on each. Ways of one name that lie within about 10 km of each other are one road, the same name further away another. Names and distances only, but a road name says where you were, so it needs `locations:read`. `mappedM` is the distance of moves with map data; moves without it count towards nothing, and `pending` is true while moves still wait for their ways to be worked out after an upgrade.",
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
      // The fill of ways after an upgrade changes no stamp of a segment: how many wait is part of it.
      extra: async (scope) => [
        await mapStamp(ctx.db),
        await countMovesLacking(ctx.db, scope.deviceIds, {
          startMs: scope.start.getTime(),
          endMs: scope.end.getTime(),
        }),
      ],
      load: async (scope) =>
        loadWays(
          ctx.db,
          scope,
          query.mode ?? null,
          // Every mode's moves, for the list of modes present; the answer counts the asked one's.
          await loadMoveWays(
            ctx.db,
            scope.deviceIds,
            { startMs: scope.start.getTime(), endMs: scope.end.getTime() },
            null,
          ),
        ),
    }),
);
