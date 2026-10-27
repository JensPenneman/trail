import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { daysResponseSchema } from "@trail/contracts/stats";
import { apiFetch } from "../api/apiFetch";
import { type DaysParams, queryKeys } from "../api/queryKeys";

/**
 * Per-day totals (calendar dots, yearly totals) for local dates `from..to`
 * inclusive. Null params ask for nothing; `refetchInterval` asks again while
 * a page expects the sums to change (the Devices page while uploads come in).
 */
export function useDays(
  params: DaysParams | null,
  { refetchInterval = false }: { refetchInterval?: number | false } = {},
) {
  return useQuery({
    queryKey: params === null ? queryKeys.all.days : queryKeys.days(params),
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.statsDays, daysResponseSchema, {
        query: params === null ? {} : params,
        signal,
      }),
    enabled: params !== null,
    placeholderData: keepPreviousData,
    refetchInterval,
  });
}
