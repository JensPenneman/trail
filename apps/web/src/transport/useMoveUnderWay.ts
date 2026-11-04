import { useQueryClient } from "@tanstack/react-query";
import { moveOverAfterS, type Segment } from "@trail/contracts/transport";
import { queryKeys } from "../api/queryKeys";
import type { TimelineAnswer } from "../queries/timelineAnswer";
import { useNow } from "../time/useNow";

/**
 * Whether a move is still going on, so its mode cannot be set yet (the API
 * answers 409 until a stop follows or `moveOverAfterS` passes without new
 * points, docs/architecture.md §17.5). It is under way when it ended less than
 * that ago and is its device's latest item in the timelines in hand: the
 * device's mode (`current`) ends after 15 minutes, too soon for this. A past
 * move reads nothing. Only the cached ranges are read: within 30 minutes of
 * midnight a later stop may lie outside them, and the dialog then says "Still
 * under way" for a move the API would accept, which is the safe side.
 */
export function useMoveUnderWay(segment: Segment): boolean {
  const now = useNow(10_000);
  const queryClient = useQueryClient();
  if (segment.kind !== "move" || now - Date.parse(segment.endedAt) >= moveOverAfterS * 1000) {
    return false;
  }
  return !queryClient
    .getQueriesData<TimelineAnswer>({ queryKey: queryKeys.all.timeline })
    .some(([, answer]) =>
      answer?.items.some(
        (item) => item.deviceId === segment.deviceId && item.startedAt > segment.startedAt,
      ),
    );
}
