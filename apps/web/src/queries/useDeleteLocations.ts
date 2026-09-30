import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import {
  type DeleteLocationsRequest,
  deleteLocationsResponseSchema,
} from "@trail/contracts/location";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** Deletes one device's points, visits, trips and events in `[from, to)`. */
export function useDeleteLocations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DeleteLocationsRequest) =>
      apiFetch(apiPaths.deleteLocations, deleteLocationsResponseSchema, { body }),
    onSuccess: (_result, body) => {
      for (const queryKey of [
        queryKeys.devices,
        queryKeys.device(body.deviceId),
        queryKeys.locations(body.deviceId),
        queryKeys.all.tracks,
        queryKeys.all.days,
        queryKeys.all.activity,
        queryKeys.all.visits,
        queryKeys.all.trips,
        queryKeys.all.heatmap,
      ]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}
