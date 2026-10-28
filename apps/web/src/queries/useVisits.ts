import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { visitsResponseSchema } from "@trail/contracts/visit";
import { queryKeys, type RangeParams } from "../api/queryKeys";
import { cachedFetch } from "../cache/cachedFetch";
import { dayQueryOptions } from "../cache/dayQueryOptions";

/** iOS visits (arrival/departure at a place) in `[from, to)`. */
export function useVisits(params: RangeParams | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: params === null ? queryKeys.all.visits : queryKeys.visits(params),
    queryFn: ({ client, queryKey, signal }) =>
      cachedFetch({ client, queryKey, signal }, apiPaths.visits, visitsResponseSchema, {
        query: params === null ? {} : params,
      }),
    enabled: params !== null,
    select: (response) => response.visits,
    ...dayQueryOptions(queryClient, "visits", params),
  });
}
