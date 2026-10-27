import { useInfiniteQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { dataAccessLogResponseSchema } from "@trail/contracts/dataAccess";
import { apiFetch } from "../api/apiFetch";
import { type AccessLogParams, queryKeys } from "../api/queryKeys";

/** Lines per page: enough to fill a screen or two, few enough to come at once. */
const accessLogPageSize = 50;

/**
 * The lines of the data access log, newest hour first, a page at a time:
 * each next page follows the previous one's keyset cursor, so a line counted
 * again meanwhile neither moves nor shows twice.
 */
export function useAccessLog(params: AccessLogParams, { enabled = true } = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.accessLog(params),
    queryFn: ({ pageParam, signal }) =>
      apiFetch(apiPaths.v1.accessLog.root, dataAccessLogResponseSchema, {
        query: { ...params, limit: accessLogPageSize, cursor: pageParam },
        signal,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
  });
}
