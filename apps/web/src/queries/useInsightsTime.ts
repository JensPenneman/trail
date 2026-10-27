import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { insightsTimeSchema } from "@trail/contracts/insights";
import { apiFetch } from "../api/apiFetch";
import { type InsightsParams, queryKeys } from "../api/queryKeys";

/** When the signed-in person travels: the hours of the week (`/api/v1/insights/time`). */
export function useInsightsTime(params: InsightsParams) {
  return useQuery({
    queryKey: queryKeys.insightsTime(params),
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.v1.insights.time, insightsTimeSchema, {
        query: { from: params.from, to: params.to, devices: params.deviceIds, mode: params.mode },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}
