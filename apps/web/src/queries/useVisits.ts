import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { visitsResponseSchema } from "@trail/contracts/visit";
import { apiFetch } from "../api/apiFetch";
import { queryKeys, type RangeParams } from "../api/queryKeys";

/** iOS visits (arrival/departure at a place) in `[from, to)`. */
export function useVisits(params: RangeParams | null) {
  return useQuery({
    queryKey: params === null ? queryKeys.all.visits : queryKeys.visits(params),
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.visits, visitsResponseSchema, {
        query: params === null ? {} : params,
        signal,
      }),
    enabled: params !== null,
    select: (response) => response.visits,
  });
}
