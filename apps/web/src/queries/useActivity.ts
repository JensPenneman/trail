import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { activityResponseSchema } from "@trail/contracts/stats";
import { type ActivityParams, queryKeys } from "../api/queryKeys";
import { cachedFetch } from "../cache/cachedFetch";
import { freshFor } from "../cache/cachePolicy";

/**
 * Hourly points/uploads over the last `hours`; invalidated by every `ingest`
 * event. Null params ask for nothing.
 */
export function useActivity(params: ActivityParams | null) {
  return useQuery({
    queryKey: params === null ? queryKeys.all.activity : queryKeys.activity(params),
    queryFn: ({ client, queryKey, signal }) =>
      cachedFetch({ client, queryKey, signal }, apiPaths.statsActivity, activityResponseSchema, {
        query: params === null ? {} : params,
      }),
    enabled: params !== null,
    staleTime: freshFor("activity"),
    // Hour buckets roll over even when nothing arrives.
    refetchInterval: 5 * 60_000,
  });
}
