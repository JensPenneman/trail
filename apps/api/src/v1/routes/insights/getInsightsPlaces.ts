import { insightsPlacesSchema, insightsQuerySchema } from "@trail/contracts/insights";
import { loadPlaces } from "../../../insights/loadPlaces";
import { mapStamp } from "../../../insights/mapStamp";
import { defineRoute } from "../../defineRoute";
import { answerInsights } from "./answerInsights";

/** `GET /api/v1/insights/places` */
export const getInsightsPlaces = defineRoute(
  {
    method: "get",
    path: "/api/v1/insights/places",
    operationId: "getInsightsPlaces",
    summary: "Get the places you spent time at",
    description:
      "Where the stops of a period of local days add up: places are cells of about 100 m (zoom 18 of the Web Mercator grid; neighbouring cells with stops fold into one place, 3 × 3 at most), each with the time spent there (your devices joined), its visits (stays that started there in the period), its days, the span of them and the time-weighted centre of the stays to four decimals — about 10 m — which is why it needs `locations:read`. A place is named from map data where there is a public transport stop within 150 m or a named road under the device when it arrived and left. The fifty places with most time come with the rest added up. Only your own devices, or the ones the token may reach (another's is a 404).",
    tags: ["Insights"],
    auth: { scopes: ["locations:read"] },
    request: { query: insightsQuerySchema },
    errors: [404],
    responses: { 200: insightsPlacesSchema, 304: null },
  },
  ({ ctx, auth, query, ifNoneMatch }) =>
    answerInsights({
      ctx,
      auth,
      ifNoneMatch,
      operationId: "getInsightsPlaces",
      asked: query,
      query,
      extra: () => mapStamp(ctx.db),
      load: (scope) => loadPlaces(ctx.db, auth, query, scope),
    }),
);
