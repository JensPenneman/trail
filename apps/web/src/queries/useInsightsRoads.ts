import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { insightsRoadsSchema } from "@trail/contracts/insights";
import { type InsightsParams, queryKeys } from "../api/queryKeys";
import { cachedFetch } from "../cache/cachedFetch";
import { freshFor } from "../cache/cachePolicy";

/** The roads and railways the signed-in person travelled on (`/api/v1/insights/roads`). */
export function useInsightsRoads(params: InsightsParams) {
  return useQuery({
    queryKey: queryKeys.insightsRoads(params),
    queryFn: ({ client, queryKey, signal }) =>
      cachedFetch({ client, queryKey, signal }, apiPaths.v1.insights.roads, insightsRoadsSchema, {
        query: { from: params.from, to: params.to, devices: params.deviceIds, mode: params.mode },
      }),
    placeholderData: keepPreviousData,
    staleTime: freshFor("insights"),
  });
}
