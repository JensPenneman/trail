import { insightsPlaceQuerySchema, insightsPlaceSchema } from "@trail/contracts/insights";
import { loadPlace } from "../../../insights/loadPlace";
import { mapStamp } from "../../../insights/mapStamp";
import { defineRoute } from "../../defineRoute";
import { answerInsights } from "./answerInsights";

/** `GET /api/v1/insights/place` */
export const getInsightsPlace = defineRoute(
  {
    method: "get",
    path: "/api/v1/insights/place",
    operationId: "getInsightsPlace",
    summary: "Get one place over a period",
    description:
      "One place from `GET /api/v1/insights/places`, named by its `place` key: the time spent there per day, week or month, and the days with time there, newest first, each with its time, visits and first and last moment. A cell folded into a neighbour's place resolves to that place; a key with no stay in the period gives `place: null`. The key is a query parameter, never part of the path. `locations:read`, like the list: the answer holds the place's centre.",
    tags: ["Insights"],
    auth: { scopes: ["locations:read"] },
    request: { query: insightsPlaceQuerySchema },
    errors: [404],
    responses: { 200: insightsPlaceSchema, 304: null },
  },
  ({ ctx, auth, query, ifNoneMatch }) =>
    answerInsights({
      ctx,
      auth,
      ifNoneMatch,
      operationId: "getInsightsPlace",
      asked: query,
      query,
      extra: () => mapStamp(ctx.db),
      load: (scope) => loadPlace(ctx.db, auth, query, scope),
    }),
);
