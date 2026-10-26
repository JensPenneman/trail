import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/queryKeys";

/** Events sent while the stream was down are lost; refetch everything they would have updated. */
export function resyncAfterGap(queryClient: QueryClient): void {
  for (const queryKey of [
    queryKeys.devices,
    queryKeys.all.tracks,
    queryKeys.all.activity,
    queryKeys.all.ingestLog,
    queryKeys.all.levelTracks,
    queryKeys.all.timeline,
    queryKeys.all.deviceMode,
    queryKeys.people,
    queryKeys.shares,
    queryKeys.incomingShares,
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
