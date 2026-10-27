import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { insightsOverviewSchema } from "@trail/contracts/insights";
import { apiFetch } from "../api/apiFetch";
import { type InsightsParams, queryKeys } from "../api/queryKeys";

/**
 * How the signed-in person travelled in a period (`/api/v1/insights/overview`).
 * The previous answer stays on screen while another period loads; `segments`
 * events refetch it.
 */
export function useInsightsOverview(params: InsightsParams) {
  return useQuery({
    queryKey: queryKeys.insightsOverview(params),
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.v1.insights.overview, insightsOverviewSchema, {
        query: { from: params.from, to: params.to, devices: params.deviceIds },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}
