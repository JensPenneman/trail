import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { insightsTimeSchema } from "@trail/contracts/insights";
import { type InsightsParams, queryKeys } from "../api/queryKeys";
import { cachedFetch } from "../cache/cachedFetch";
import { freshFor } from "../cache/cachePolicy";

/** When the signed-in person travels: the hours of the week (`/api/v1/insights/time`). */
export function useInsightsTime(params: InsightsParams) {
  return useQuery({
    queryKey: queryKeys.insightsTime(params),
    queryFn: ({ client, queryKey, signal }) =>
      cachedFetch({ client, queryKey, signal }, apiPaths.v1.insights.time, insightsTimeSchema, {
        query: { from: params.from, to: params.to, devices: params.deviceIds, mode: params.mode },
      }),
    placeholderData: keepPreviousData,
    staleTime: freshFor("insights"),
  });
}
