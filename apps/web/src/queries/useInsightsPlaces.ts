import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { insightsPlacesSchema } from "@trail/contracts/insights";
import { type InsightsParams, queryKeys } from "../api/queryKeys";
import { cachedFetch } from "../cache/cachedFetch";
import { freshFor } from "../cache/cachePolicy";

/** Where the signed-in person's stops add up in a period (`/api/v1/insights/places`). */
export function useInsightsPlaces(params: InsightsParams) {
  return useQuery({
    queryKey: queryKeys.insightsPlaces(params),
    queryFn: ({ client, queryKey, signal }) =>
      cachedFetch({ client, queryKey, signal }, apiPaths.v1.insights.places, insightsPlacesSchema, {
        query: { from: params.from, to: params.to, devices: params.deviceIds },
      }),
    placeholderData: keepPreviousData,
    staleTime: freshFor("insights"),
  });
}
