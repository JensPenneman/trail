import type { QueryClient } from "@tanstack/react-query";
import type { ServerEvent } from "@trail/contracts/events";
import type { TracksResponse } from "@trail/contracts/track";
import type { SessionUser } from "@trail/contracts/user";
import { queryKeys } from "../api/queryKeys";
import { removeDeviceFromCache } from "../devices/removeDeviceFromCache";
import { upsertDeviceInCache } from "../devices/upsertDeviceInCache";
import { forgetShareInCache } from "../people/forgetShareInCache";
import { updatePersonInCache } from "../people/updatePersonInCache";
import { invalidateSharing } from "../queries/invalidateSharing";
import { appendTrackPoints } from "./appendTrackPoints";
import { applyDaysEvent } from "./applyDaysEvent";
import type { LiveStore } from "./createLiveStore";
import { isRangeParams } from "./isRangeParams";
import { staleDaySlices } from "./staleDaySlices";

/** The server's default `maxAccuracy` for `/api/tracks`, which the web app never overrides. */
const trackMaxAccuracyM = 200;

/** What a finished processing window changes: its levels, its stops and moves, the period sums. */
const processed = new Set(["level-tracks", "timeline", "insights"]);

/** Folds one server event into the query caches and the live store. */
export function applyServerEvent(
  queryClient: QueryClient,
  store: LiveStore,
  event: ServerEvent,
): void {
  switch (event.type) {
    case "hello":
      // `versions` came with the `days` event and the stream's ids: a server that names them
      // tells the page of every change to the daily statistics.
      store.setServer({
        versions: event.versions ?? null,
        sendsDays: event.versions !== undefined,
      });
      return;
    case "days":
      store.setServer({ sendsDays: true });
      applyDaysEvent(queryClient, event);
      return;
    case "resync":
      // useServerEvents refetches what it may have missed, spread over a while.
      return;
    case "device":
      upsertDeviceInCache(queryClient, event.device);
      // Distances to people start from one's own newest position.
      void queryClient.invalidateQueries({ queryKey: queryKeys.people, refetchType: "active" });
      return;
    case "person":
      updatePersonInCache(queryClient, event.userId, event.device);
      // Their track on the map grows with the upload (shown only where their share has history).
      void queryClient.invalidateQueries({
        queryKey: queryKeys.personTracksOf(event.userId),
        refetchType: "active",
      });
      return;
    case "share":
      if (event.change === "revoked") {
        forgetShareInCache(queryClient, event.shareId);
        store.dismissShareNotice(event.shareId);
      }
      if (event.change === "created")
        store.addShareNotice({ shareId: event.shareId, at: Date.now() });
      void invalidateSharing(queryClient);
      return;
    case "device-removed":
      removeDeviceFromCache(queryClient, event.deviceId);
      return;
    case "segments":
      // Processing finished a window: its levels, stops and moves, the current mode and the
      // statistics of Insights changed — of that device, in that window only.
      void staleDaySlices(queryClient, processed, {
        deviceId: event.deviceId,
        spans: [{ from: Date.parse(event.from), to: Date.parse(event.to) }],
        timezone: queryClient.getQueryData<SessionUser | null>(queryKeys.session)?.timezone ?? null,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.deviceMode(event.deviceId) });
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
      // Calendar dots catch up the next time they are shown, unless the server's `days`
      // events update them in place (and keep them fresh enough to settle past days with).
      if (!store.getSnapshot().sendsDays) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.all.days, refetchType: "none" });
      }
      // The raw point list catches up the next time it is shown.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.locations(event.deviceId),
        refetchType: "none",
      });
      return;
    }
  }
}
