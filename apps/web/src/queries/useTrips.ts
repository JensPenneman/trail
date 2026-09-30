import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { tripsResponseSchema } from "@trail/contracts/trip";
import { apiFetch } from "../api/apiFetch";
import { queryKeys, type RangeParams } from "../api/queryKeys";

/** Trips recorded with Overland's trip button in `[from, to)`. */
export function useTrips(params: RangeParams | null) {
  return useQuery({
    queryKey: params === null ? queryKeys.all.trips : queryKeys.trips(params),
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.trips, tripsResponseSchema, {
        query: params === null ? {} : params,
        signal,
      }),
    enabled: params !== null,
    select: (response) => response.trips,
  });
}
