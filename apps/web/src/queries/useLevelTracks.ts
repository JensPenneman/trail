import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { levelTracksResponseSchema } from "@trail/contracts/transport";
import { type LevelTracksParams, queryKeys } from "../api/queryKeys";
import { cachedFetch } from "../cache/cachedFetch";
import { dayQueryOptions } from "../cache/dayQueryOptions";

/**
 * Tracks at a level of calculation (`/api/v1/tracks`, with the session). Null
 * params keep the query off — the raw level comes from `useTracks`, which the
 * live stream appends to. `segments` events refetch the ranges they name.
 */
export function useLevelTracks(params: LevelTracksParams | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: params === null ? queryKeys.all.levelTracks : queryKeys.levelTracks(params),
    queryFn: ({ client, queryKey, signal }) =>
      cachedFetch({ client, queryKey, signal }, apiPaths.v1.tracks, levelTracksResponseSchema, {
        query:
          params === null
            ? {}
            : { from: params.from, to: params.to, level: params.level, devices: params.deviceIds },
      }),
    enabled: params !== null,
    placeholderData: keepPreviousData,
    ...dayQueryOptions(queryClient, "level-tracks", params),
  });
}
