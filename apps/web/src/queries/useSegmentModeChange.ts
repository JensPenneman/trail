import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { type ChosenMode, segmentResponseSchema } from "@trail/contracts/transport";
import { apiFetch } from "../api/apiFetch";
import { staleProcessed } from "../live/staleProcessed";

/**
 * Sets a move's mode (a mode) or resets it to the inferred one (null). What
 * the move's time shows is asked for again as a `segments` event would have
 * it (staleProcessed: the levels, the timeline, Insights, the calendar's
 * digests and the current mode) — without waiting for the event, which does
 * the same for other open dashboards and, on this page, nothing more.
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
    onSuccess: ({ segment }) => {
      staleProcessed(
        queryClient,
        { deviceId: segment.deviceId, from: segment.startedAt, to: segment.endedAt },
        "correction",
      );
    },
  });
}
