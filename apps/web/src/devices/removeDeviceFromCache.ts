import type { QueryClient } from "@tanstack/react-query";
import type { DeviceListResponse } from "@trail/contracts/device";
import { queryKeys } from "../api/queryKeys";
import { browserCacheOf } from "../cache/attachBrowserCache";
import { goneDevices } from "./goneDevices";

/**
 * Forgets a deleted device. Its points are gone on the server too, so every
 * cached range that may have included them is refetched, and the copy on
 * disk loses every entry that may hold them.
 */
export function removeDeviceFromCache(queryClient: QueryClient, deviceId: string): void {
  // first, so that no query of the device can start again from here on
  goneDevices.mark(queryClient, deviceId);
  void browserCacheOf(queryClient)?.forgetDevice(deviceId);
  const own = [
    queryKeys.device(deviceId),
    queryKeys.locations(deviceId),
    [...queryKeys.all.ingestLog, deviceId],
  ];
  for (const queryKey of own) void queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<DeviceListResponse>(queryKeys.devices, (current) =>
    current === undefined
      ? current
      : { devices: current.devices.filter((device) => device.id !== deviceId) },
  );
  // Emptied before they are forgotten: removing a query tells nobody, and a page that shows the
  // device (deleted in another tab) would go on showing it. Gone, they are not fetched again.
  for (const queryKey of own) void queryClient.resetQueries({ queryKey });
  for (const queryKey of own) queryClient.removeQueries({ queryKey });
  for (const queryKey of [
    queryKeys.all.tracks,
    queryKeys.all.days,
    queryKeys.all.activity,
    queryKeys.all.visits,
    queryKeys.all.trips,
    queryKeys.all.heatmap,
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
