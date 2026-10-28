import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { heatmapResponseSchema } from "@trail/contracts/heatmap";
import { type HeatmapParams, queryKeys } from "../api/queryKeys";
import { cachedFetch } from "../cache/cachedFetch";
import { freshFor } from "../cache/cachePolicy";

/** All-time density cells in the viewport; the previous cells stay visible while panning. */
export function useHeatmap(params: HeatmapParams | null) {
  return useQuery({
    queryKey: params === null ? queryKeys.all.heatmap : queryKeys.heatmap(params),
    queryFn: ({ client, queryKey, signal }) =>
      cachedFetch({ client, queryKey, signal }, apiPaths.heatmap, heatmapResponseSchema, {
        query: params === null ? {} : params,
      }),
    enabled: params !== null,
    placeholderData: keepPreviousData,
    staleTime: freshFor("heatmap"),
  });
}
