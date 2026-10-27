import { type UseQueryResult, useQueries } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { type PersonTrackResponse, personTrackResponseSchema } from "@trail/contracts/person";
import { apiFetch } from "../api/apiFetch";
import { type PersonTrackParams, queryKeys } from "../api/queryKeys";

export interface PersonTrackRequest extends PersonTrackParams {
  userId: string;
}

export interface PersonTracks {
  /** Per request, in its order: the answer once it is there. */
  data: readonly (PersonTrackResponse | undefined)[];
  /** Per request, in its order: whether it waits for its first answer, and whether it failed. */
  states: readonly { pending: boolean; failed: boolean }[];
  pending: boolean;
  fetching: boolean;
  /** The first failure, if any. */
  error: Error | null;
}

/** Stable, so the combined result only changes when a query's does. */
function combine(results: UseQueryResult<PersonTrackResponse>[]): PersonTracks {
  return {
    data: results.map((result) => result.data),
    states: results.map((result) => ({ pending: result.isPending, failed: result.isError })),
    pending: results.some((result) => result.isPending),
    fetching: results.some((result) => result.isFetching),
    error: results.find((result) => result.error !== null)?.error ?? null,
  };
}

/**
 * The tracks of people whose shares include history, in `[from, to)`, one
 * request per person. Callers ask only for shares with history (anything
 * else is a 404 by contract); nothing of another person's track stays cached
 * once it is off screen, and `person` events refetch it.
 */
export function usePersonTracks(requests: readonly PersonTrackRequest[]): PersonTracks {
  return useQueries({
    queries: requests.map(({ userId, ...params }) => ({
      queryKey: queryKeys.personTracks(userId, params),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiFetch(apiPaths.v1.people.track(userId), personTrackResponseSchema, {
          query: { from: params.from, to: params.to, deviceIds: params.deviceIds },
          signal,
        }),
      gcTime: 0,
    })),
    combine,
  });
}
