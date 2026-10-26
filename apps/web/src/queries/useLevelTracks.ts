import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { levelTracksResponseSchema } from "@trail/contracts/transport";
import { apiFetch } from "../api/apiFetch";
import { type LevelTracksParams, queryKeys } from "../api/queryKeys";

/**
 * Tracks at a level of calculation (`/api/v1/tracks`, with the session). Null
 * params keep the query off — the raw level comes from `useTracks`, which the
 * live stream appends to. `segments` events refetch it.
 */
export function useLevelTracks(params: LevelTracksParams | null) {
  return useQuery({
    queryKey: params === null ? queryKeys.all.levelTracks : queryKeys.levelTracks(params),
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.v1.tracks, levelTracksResponseSchema, {
        query:
          params === null
            ? {}
            : { from: params.from, to: params.to, level: params.level, devices: params.deviceIds },
        signal,
      }),
    enabled: params !== null,
    placeholderData: keepPreviousData,
  });
}
