import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { insightsPlaceSchema } from "@trail/contracts/insights";
import { type InsightsParams, queryKeys } from "../api/queryKeys";
import { cachedFetch } from "../cache/cachedFetch";
import { freshFor } from "../cache/cachePolicy";

/** One place over a period (`/api/v1/insights/place?place=`); null asks for nothing. */
export function useInsightsPlace(place: string | null, params: InsightsParams) {
  return useQuery({
    queryKey: queryKeys.insightsPlace(place ?? "", params),
    queryFn: ({ client, queryKey, signal }) =>
      cachedFetch({ client, queryKey, signal }, apiPaths.v1.insights.place, insightsPlaceSchema, {
        query: { from: params.from, to: params.to, devices: params.deviceIds, place },
      }),
    enabled: place !== null,
    placeholderData: keepPreviousData,
    staleTime: freshFor("insights"),
  });
}
