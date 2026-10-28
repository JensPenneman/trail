import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { daysResponseSchema } from "@trail/contracts/stats";
import { type DaysParams, queryKeys } from "../api/queryKeys";
import { cachedFetch } from "../cache/cachedFetch";
import { freshFor } from "../cache/cachePolicy";
import { useLiveState } from "../live/useLiveState";

/**
 * Per-day totals (calendar dots, yearly totals) for local dates `from..to`
 * inclusive. Null params ask for nothing; `refetchInterval` asks again while
 * a page expects the sums to change (Settings › Devices while uploads come in)
 * — unless the server tells this page of every change with its `days` event,
 * which updates the totals in place.
 */
export function useDays(
  params: DaysParams | null,
  { refetchInterval = false }: { refetchInterval?: number | false } = {},
) {
  const { sendsDays } = useLiveState();
  return useQuery({
    queryKey: params === null ? queryKeys.all.days : queryKeys.days(params),
    queryFn: ({ client, queryKey, signal }) =>
      cachedFetch({ client, queryKey, signal }, apiPaths.statsDays, daysResponseSchema, {
        query: params === null ? {} : params,
      }),
    enabled: params !== null,
    placeholderData: keepPreviousData,
    staleTime: freshFor("days"),
    refetchInterval: sendsDays ? false : refetchInterval,
  });
}
