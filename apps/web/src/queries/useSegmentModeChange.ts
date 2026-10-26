import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { type ChosenMode, segmentResponseSchema } from "@trail/contracts/transport";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/**
 * Sets a move's mode (a mode) or resets it to the inferred one (null). The
 * timeline and the tracks at their levels are refetched; the server's
 * `segments` event does the same for other open dashboards.
 */
export function useSegmentModeChange(segmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mode: ChosenMode | null) =>
      mode === null
        ? apiFetch(apiPaths.v1.segments.mode(segmentId), segmentResponseSchema, {
            method: "DELETE",
          })
        : apiFetch(apiPaths.v1.segments.mode(segmentId), segmentResponseSchema, {
            method: "PUT",
            body: { mode },
          }),
    onSuccess: () => {
      for (const queryKey of [
        queryKeys.all.timeline,
        queryKeys.all.levelTracks,
        queryKeys.all.deviceMode,
      ]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}
