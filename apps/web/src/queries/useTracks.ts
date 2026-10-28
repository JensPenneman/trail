import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { tracksResponseSchema } from "@trail/contracts/track";
import { queryKeys, type RangeParams } from "../api/queryKeys";
import { cachedFetch } from "../cache/cachedFetch";
import { dayQueryOptions } from "../cache/dayQueryOptions";

/**
 * Tracks of every (or the selected) device in `[from, to)`. `ingest` events
 * append new points to every cached range that covers them, so the live map
 * grows without refetching.
 */
export function useTracks(params: RangeParams | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: params === null ? queryKeys.all.tracks : queryKeys.tracks(params),
    queryFn: ({ client, queryKey, signal }) =>
      cachedFetch({ client, queryKey, signal }, apiPaths.tracks, tracksResponseSchema, {
        query: params === null ? {} : params,
      }),
    enabled: params !== null,
    placeholderData: keepPreviousData,
    ...dayQueryOptions(queryClient, "tracks", params),
  });
}
