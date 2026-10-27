import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { dataAccessLogResponseSchema } from "@trail/contracts/dataAccess";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** The newest few lines of one actor's accesses (an actor id): what it did last. */
export function useRecentAccess(actorId: string, count: number) {
  return useQuery({
    queryKey: queryKeys.recentAccess(actorId, count),
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.v1.accessLog.root, dataAccessLogResponseSchema, {
        query: { actorId, limit: count },
        signal,
      }),
    select: (page) => page.items,
  });
}
