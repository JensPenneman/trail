import type { QueryClient } from "@tanstack/react-query";
import type { DeviceListResponse } from "@trail/contracts/device";
import { queryKeys } from "../api/queryKeys";

/**
 * Forgets a deleted device. Its points are gone on the server too, so every
 * cached range that may have included them is refetched.
 */
export function removeDeviceFromCache(queryClient: QueryClient, deviceId: string): void {
  queryClient.setQueryData<DeviceListResponse>(queryKeys.devices, (current) =>
    current === undefined
      ? current
      : { devices: current.devices.filter((device) => device.id !== deviceId) },
  );
  queryClient.removeQueries({ queryKey: queryKeys.device(deviceId) });
  queryClient.removeQueries({ queryKey: queryKeys.locations(deviceId) });
  queryClient.removeQueries({ queryKey: [...queryKeys.all.ingestLog, deviceId] });
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
