import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { heatmapResponseSchema } from "@trail/contracts/heatmap";
import { apiFetch } from "../api/apiFetch";
import { type HeatmapParams, queryKeys } from "../api/queryKeys";

/** All-time density cells in the viewport; the previous cells stay visible while panning. */
export function useHeatmap(params: HeatmapParams | null) {
  return useQuery({
    queryKey: params === null ? queryKeys.all.heatmap : queryKeys.heatmap(params),
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.heatmap, heatmapResponseSchema, {
        query: params === null ? {} : params,
        signal,
      }),
    enabled: params !== null,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}
