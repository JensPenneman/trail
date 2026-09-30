import type { QueryClient } from "@tanstack/react-query";
import type { DeviceListResponse, DeviceResponse, DeviceSummary } from "@trail/contracts/device";
import { queryKeys } from "../api/queryKeys";

/** Replaces (or adds) a device in the list and detail caches — from a server event or a mutation. */
export function upsertDeviceInCache(queryClient: QueryClient, device: DeviceSummary): void {
  queryClient.setQueryData<DeviceListResponse>(queryKeys.devices, (current) => {
    if (current === undefined) return current;
    const exists = current.devices.some((candidate) => candidate.id === device.id);
    return {
      devices: exists
        ? current.devices.map((candidate) => (candidate.id === device.id ? device : candidate))
        : [...current.devices, device],
    };
  });
  queryClient.setQueryData<DeviceResponse>(queryKeys.device(device.id), { device });
}
