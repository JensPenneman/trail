import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { heatmapResponseSchema } from "@trail/contracts/heatmap";
import { type HeatmapParams, queryKeys } from "../api/queryKeys";
import { cachedFetch } from "../cache/cachedFetch";
import { freshFor } from "../cache/cachePolicy";

/**
 * Density cells in the viewport. The previous cells stay visible while panning, but only while
 * they are the same kind of answer — measure, period and devices — as the one asked for: another
 * measure's cells would be drawn with this one's key.
 */
export function useHeatmap(params: HeatmapParams | null) {
  return useQuery({
    queryKey: params === null ? queryKeys.all.heatmap : queryKeys.heatmap(params),
    queryFn: ({ client, queryKey, signal }) =>
      cachedFetch({ client, queryKey, signal }, apiPaths.heatmap, heatmapResponseSchema, {
        query: params === null ? {} : params,
      }),
    enabled: params !== null,
    placeholderData: (previous, previousQuery) =>
      params !== null && sameHeatKind(previousQuery?.queryKey[1], params) ? previous : undefined,
    staleTime: freshFor("heatmap"),
  });
}

const sameDevices = (a: readonly string[] | null, b: readonly string[] | null): boolean =>
  (a?.join(",") ?? "") === (b?.join(",") ?? "");

/** Whether a cached query's parameters ask for the same kind of answer: measure, period, devices. */
export function sameHeatKind(earlier: unknown, now: HeatmapParams): boolean {
  if (typeof earlier !== "object" || earlier === null) return false;
  const before = earlier as Partial<HeatmapParams>;
  return (
    before.heat === now.heat &&
    before.from === now.from &&
    before.to === now.to &&
    sameDevices(before.deviceIds ?? null, now.deviceIds)
  );
}
