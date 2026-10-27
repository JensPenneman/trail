import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { activityResponseSchema } from "@trail/contracts/stats";
import { apiFetch } from "../api/apiFetch";
import { type ActivityParams, queryKeys } from "../api/queryKeys";

/**
 * Hourly points/uploads over the last `hours`; invalidated by every `ingest`
 * event. Null params ask for nothing.
 */
export function useActivity(params: ActivityParams | null) {
  return useQuery({
    queryKey: params === null ? queryKeys.all.activity : queryKeys.activity(params),
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.statsActivity, activityResponseSchema, {
        query: params === null ? {} : params,
        signal,
      }),
    enabled: params !== null,
    // Hour buckets roll over even when nothing arrives.
    refetchInterval: 5 * 60_000,
  });
}
