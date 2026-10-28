import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/queryKeys";

/**
 * Events sent while the stream was down are lost (or the server could not
 * replay them): refetch everything they would have updated. Most of it comes
 * back as `304 Not Modified` when nothing changed — each answer goes with its
 * ETag — and only what is on screen is asked for at once.
 */
export function resyncAfterGap(queryClient: QueryClient): void {
  for (const queryKey of [
    queryKeys.devices,
    queryKeys.all.tracks,
    queryKeys.all.activity,
    queryKeys.all.ingestLog,
    queryKeys.all.levelTracks,
    queryKeys.all.timeline,
    queryKeys.all.deviceMode,
    queryKeys.all.days,
    queryKeys.all.visits,
    queryKeys.all.trips,
    queryKeys.all.insights,
    queryKeys.people,
    queryKeys.shares,
    queryKeys.incomingShares,
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
