import type { QueryClient } from "@tanstack/react-query";
import type { ServerEvent } from "@trail/contracts/events";
import type { TracksResponse } from "@trail/contracts/track";
import { queryKeys } from "../api/queryKeys";
import { removeDeviceFromCache } from "../devices/removeDeviceFromCache";
import { upsertDeviceInCache } from "../devices/upsertDeviceInCache";
import { appendTrackPoints } from "./appendTrackPoints";
import type { LiveStore } from "./createLiveStore";
import { isRangeParams } from "./isRangeParams";

/** The server's default `maxAccuracy` for `/api/tracks`, which the web app never overrides. */
const trackMaxAccuracyM = 200;

/** Folds one server event into the query caches and the live store. */
export function applyServerEvent(
  queryClient: QueryClient,
  store: LiveStore,
  event: ServerEvent,
): void {
  switch (event.type) {
    case "hello":
      return;
    case "device":
      upsertDeviceInCache(queryClient, event.device);
      return;
    case "device-removed":
      removeDeviceFromCache(queryClient, event.deviceId);
      return;
    case "session-ended":
      // The route guard takes the person to the sign-in page, with a way back here.
      queryClient.setQueryData(queryKeys.session, null);
      return;
    case "ingest": {
      store.addUpload({
        deviceId: event.deviceId,
        receivedAt: event.receivedAt,
        inserted: event.inserted,
        duplicates: event.duplicates,
        rejected: event.rejected,
      });
      if (event.points.length > 0) {
        const cached = queryClient.getQueriesData<TracksResponse>({
          queryKey: queryKeys.all.tracks,
        });
        for (const [queryKey, data] of cached) {
          if (data === undefined) continue;
          const params = queryKey[1];
          if (!isRangeParams(params)) continue;
          if (params.deviceIds !== null && !params.deviceIds.includes(event.deviceId)) continue;
          const next = appendTrackPoints(data, event.deviceId, event.points, trackMaxAccuracyM);
          if (next !== data) queryClient.setQueryData(queryKey, next);
        }
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.all.activity });
      void queryClient.invalidateQueries({
        queryKey: [...queryKeys.all.ingestLog, event.deviceId],
      });
      // Calendar dots and the raw point list catch up the next time they are shown.
      void queryClient.invalidateQueries({ queryKey: queryKeys.all.days, refetchType: "none" });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.locations(event.deviceId),
        refetchType: "none",
      });
      return;
    }
  }
}
