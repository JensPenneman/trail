import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { insightsOverviewSchema } from "@trail/contracts/insights";
import { type InsightsParams, queryKeys } from "../api/queryKeys";
import { cachedFetch } from "../cache/cachedFetch";
import { freshFor } from "../cache/cachePolicy";

/**
 * How the signed-in person travelled in a period (`/api/v1/insights/overview`).
 * The previous answer stays on screen while another period loads; `segments`
 * events refetch it.
 */
export function useInsightsOverview(params: InsightsParams) {
  return useQuery({
    queryKey: queryKeys.insightsOverview(params),
    queryFn: ({ client, queryKey, signal }) =>
      cachedFetch(
        { client, queryKey, signal },
        apiPaths.v1.insights.overview,
        insightsOverviewSchema,
        { query: { from: params.from, to: params.to, devices: params.deviceIds } },
      ),
    placeholderData: keepPreviousData,
    staleTime: freshFor("insights"),
  });
}
