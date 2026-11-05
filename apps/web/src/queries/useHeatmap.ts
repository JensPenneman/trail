import { type QueryClient, useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import type { HeatmapResponse } from "@trail/contracts/heatmap";
import { heatmapResponseSchema } from "@trail/contracts/heatmap";
import { type HeatmapParams, queryKeys } from "../api/queryKeys";
import { cachedFetch } from "../cache/cachedFetch";
import { freshFor } from "../cache/cachePolicy";
import { useLiveState } from "../live/useLiveState";

/**
 * When an answer that says recent days are still being worked out is asked for again, if the event
 * stream does not tell: the stream's `segments` event, sent when the cells are made, refetches it
 * (`invalidateStopHeat`). Without a stream it is polled, 10 s, then 30 s, then every 60 s.
 */
export function pendingRetryMs(
  pending: boolean,
  connection: "connecting" | "open" | "reconnecting",
  answers: number,
): number | false {
  if (!pending || connection === "open") return false;
  return [10_000, 30_000, 60_000][Math.min(Math.max(answers, 1) - 1, 2)] ?? 60_000;
}

/**
 * Density cells in the viewport. The previous cells stay visible while panning, but only while
 * they are the same kind of answer — measure, period and devices — as the one asked for: another
 * measure's cells would be drawn with this one's key.
 */
export function useHeatmap(params: HeatmapParams | null) {
  const { connection } = useLiveState();
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
    refetchInterval: (query) =>
      pendingRetryMs(query.state.data?.pending === true, connection, query.state.dataUpdateCount),
  });
}

/**
 * The zoom the answer `data` was asked for at, read from the key of the query that holds it: a
 * placeholder kept while the view moves on belongs to the request before, not to the view now.
 */
export function heatAnsweredZoom(
  client: QueryClient,
  data: HeatmapResponse | undefined,
): number | null {
  if (data === undefined) return null;
  for (const query of client.getQueryCache().findAll({ queryKey: queryKeys.all.heatmap })) {
    if (query.state.data !== data) continue;
    const asked = query.queryKey[1] as Partial<HeatmapParams> | undefined;
    return asked?.zoom ?? null;
  }
  return null;
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
    (before.mode ?? null) === now.mode &&
    sameDevices(before.deviceIds ?? null, now.deviceIds)
  );
}
