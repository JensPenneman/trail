import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { activityResponseSchema } from "@trail/contracts/stats";
import { apiFetch } from "../api/apiFetch";
import { type ActivityParams, queryKeys } from "../api/queryKeys";

/** Hourly points/uploads over the last `hours`; invalidated by every `ingest` event. */
export function useActivity(params: ActivityParams) {
  return useQuery({
    queryKey: queryKeys.activity(params),
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.statsActivity, activityResponseSchema, { query: params, signal }),
    // Hour buckets roll over even when nothing arrives.
    refetchInterval: 5 * 60_000,
  });
}
