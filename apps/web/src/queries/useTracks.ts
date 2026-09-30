import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { tracksResponseSchema } from "@trail/contracts/track";
import { apiFetch } from "../api/apiFetch";
import { queryKeys, type RangeParams } from "../api/queryKeys";

/**
 * Tracks of every (or the selected) device in `[from, to)`. `ingest` events
 * append new points to every cached range that covers them, so the live map
 * grows without refetching.
 */
export function useTracks(params: RangeParams | null) {
  return useQuery({
    queryKey: params === null ? queryKeys.all.tracks : queryKeys.tracks(params),
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.tracks, tracksResponseSchema, {
        query: params === null ? {} : params,
        signal,
      }),
    enabled: params !== null,
    placeholderData: keepPreviousData,
  });
}
