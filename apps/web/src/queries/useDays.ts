import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { daysResponseSchema } from "@trail/contracts/stats";
import { apiFetch } from "../api/apiFetch";
import { type DaysParams, queryKeys } from "../api/queryKeys";

/** Per-day totals (calendar dots, yearly totals) for local dates `from..to` inclusive. */
export function useDays(params: DaysParams) {
  return useQuery({
    queryKey: queryKeys.days(params),
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.statsDays, daysResponseSchema, { query: params, signal }),
    placeholderData: keepPreviousData,
  });
}
