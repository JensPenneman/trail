import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { dataAccessSummarySchema } from "@trail/contracts/dataAccess";
import { apiFetch } from "../api/apiFetch";
import { type AccessSummaryParams, queryKeys } from "../api/queryKeys";

/**
 * Who looked at the signed-in person's data over the last 7, 30 or 90 days,
 * or what one actor did (`actorId`): the data access log summed up. The
 * previous period stays on screen while the next one loads.
 */
export function useAccessSummary(params: AccessSummaryParams, { enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.accessSummary(params),
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.v1.accessLog.summary, dataAccessSummarySchema, {
        query: { days: params.days, actorId: params.actorId },
        signal,
      }),
    placeholderData: (previous, query) =>
      query?.queryKey[2].actorId === params.actorId ? previous : undefined,
    enabled,
  });
}
