import { insightsModeFilterQuerySchema, insightsRoadsSchema } from "@trail/contracts/insights";
import { loadRoadInsights } from "../../../insights/loadRoadInsights";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/insights/roads` */
export const getInsightsRoads = defineRoute(
  {
    method: "get",
    path: "/api/v1/insights/roads",
    operationId: "getInsightsRoads",
    summary: "Get the roads you travelled",
    description:
      "The distance by kind of way — motorway down to footpath, the railways, ferry routes, and off every mapped way — and by family over a period of local days, for one transport mode or all of them, from the map matching of the moves. Shares are of the distance with map data (`mappedM`); moves without it (no map data, or not worked out again yet after an upgrade) count towards `distanceM` only.",
    tags: ["Insights"],
    auth: { scopes: ["history:read"] },
    request: { query: insightsModeFilterQuerySchema },
    // A device in `devices` that is unknown, foreign or outside the token is a 404.
    errors: [404],
    responses: { 200: insightsRoadsSchema },
  },
  async ({ ctx, auth, query }) => ({
    status: 200,
    body: await loadRoadInsights(ctx.db, auth, query),
  }),
);
