import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { insightsModeSchema } from "@trail/contracts/insights";
import type { TransportMode } from "@trail/contracts/transport";
import { type InsightsParams, queryKeys } from "../api/queryKeys";
import { cachedFetch } from "../cache/cachedFetch";
import { freshFor } from "../cache/cachePolicy";

/** One transport mode in a period (`/api/v1/insights/modes/{mode}`); null asks for nothing. */
export function useInsightsMode(mode: TransportMode | null, params: InsightsParams) {
  return useQuery({
    queryKey: queryKeys.insightsMode(mode ?? "", params),
    queryFn: ({ client, queryKey, signal }) =>
      cachedFetch(
        { client, queryKey, signal },
        apiPaths.v1.insights.mode(mode ?? ""),
        insightsModeSchema,
        { query: { from: params.from, to: params.to, devices: params.deviceIds } },
      ),
    enabled: mode !== null,
    placeholderData: keepPreviousData,
    staleTime: freshFor("insights"),
  });
}
