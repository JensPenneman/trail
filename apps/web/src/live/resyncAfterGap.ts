import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/queryKeys";

/** Events sent while the stream was down are lost; refetch everything they would have updated. */
export function resyncAfterGap(queryClient: QueryClient): void {
  for (const queryKey of [
    queryKeys.devices,
    queryKeys.all.tracks,
    queryKeys.all.activity,
    queryKeys.all.ingestLog,
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
