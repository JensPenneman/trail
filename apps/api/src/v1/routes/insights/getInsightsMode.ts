import {
  insightsModeParamsSchema,
  insightsModeSchema,
  insightsQuerySchema,
} from "@trail/contracts/insights";
import { loadModeInsights } from "../../../insights/loadModeInsights";
import { defineRoute } from "../../defineRoute";
import { answerInsights } from "./answerInsights";

/** `GET /api/v1/insights/modes/{mode}` */
export const getInsightsMode = defineRoute(
  {
    method: "get",
    path: "/api/v1/insights/modes/{mode}",
    operationId: "getInsightsMode",
    summary: "Get how you travelled in one mode",
    description:
      "One transport mode in a period of local days (as for the overview): distance, time, moves, average and typical speed, the longest and the fastest move; a series per day, week or month; distance and time per hour of the day and per day of the week; the distance by kind of way (from the map matching, where there was map data); for trains, trams and metros the part on railway track and the halts at stations, for boats the part on ferry routes; the moves by their median speed; and the five longest, fastest and most recent moves — segment ids and times, never where they went. An unknown mode is a 404.",
    tags: ["Insights"],
    auth: { scopes: ["history:read"] },
    request: { params: insightsModeParamsSchema, query: insightsQuerySchema },
    responses: { 200: insightsModeSchema, 304: null },
  },
  ({ ctx, auth, params, query, ifNoneMatch }) =>
    answerInsights({
      ctx,
      auth,
      ifNoneMatch,
      operationId: "getInsightsMode",
      asked: [params, query],
      query,
      load: (scope) => loadModeInsights(ctx.db, auth, params.mode, query, scope),
    }),
);
