import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { tripsResponseSchema } from "@trail/contracts/trip";
import { queryKeys, type RangeParams } from "../api/queryKeys";
import { cachedFetch } from "../cache/cachedFetch";
import { dayQueryOptions } from "../cache/dayQueryOptions";

/** Trips recorded with Overland's trip button in `[from, to)`. */
export function useTrips(params: RangeParams | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: params === null ? queryKeys.all.trips : queryKeys.trips(params),
    queryFn: ({ client, queryKey, signal }) =>
      cachedFetch({ client, queryKey, signal }, apiPaths.trips, tripsResponseSchema, {
        query: params === null ? {} : params,
      }),
    enabled: params !== null,
    select: (response) => response.trips,
    ...dayQueryOptions(queryClient, "trips", params),
  });
}
