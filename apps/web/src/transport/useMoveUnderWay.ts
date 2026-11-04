import { moveOverAfterS, type Segment } from "@trail/contracts/transport";
import { useDeviceMode } from "../queries/useDeviceMode";
import { useNow } from "../time/useNow";

/**
 * Whether a move is still going on, so its mode cannot be set yet (the API
 * answers 409 until a stop follows or `moveOverAfterS` passes without new
 * points, docs/architecture.md §17.5). Only a move that ended less than that
 * ago asks the device for its mode, which is cached and kept fresh by the
 * `segments` events; it is under way when the device's current segment is it.
 * A past move asks for nothing. `checking` is true until the answer is in
 * (`isLoading`: a query that is not enabled stays pending for good).
 */
export function useMoveUnderWay(segment: Segment): { underWay: boolean; checking: boolean } {
  const now = useNow(10_000);
  const recent =
    segment.kind === "move" && now - Date.parse(segment.endedAt) < moveOverAfterS * 1000;
  const mode = useDeviceMode(recent ? segment.deviceId : null);
  return {
    underWay: recent && mode.data?.current?.segmentId === segment.id,
    checking: recent && mode.isLoading,
  };
}
