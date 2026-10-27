import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { insightsModeSchema } from "@trail/contracts/insights";
import type { TransportMode } from "@trail/contracts/transport";
import { apiFetch } from "../api/apiFetch";
import { type InsightsParams, queryKeys } from "../api/queryKeys";

/** One transport mode in a period (`/api/v1/insights/modes/{mode}`); null asks for nothing. */
export function useInsightsMode(mode: TransportMode | null, params: InsightsParams) {
  return useQuery({
    queryKey: queryKeys.insightsMode(mode ?? "", params),
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.v1.insights.mode(mode ?? ""), insightsModeSchema, {
        query: { from: params.from, to: params.to, devices: params.deviceIds },
        signal,
      }),
    enabled: mode !== null,
    placeholderData: keepPreviousData,
  });
}
