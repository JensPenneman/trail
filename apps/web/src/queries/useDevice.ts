import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { type DeviceListResponse, deviceResponseSchema } from "@trail/contracts/device";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";
import { goneDevices } from "../devices/goneDevices";

/**
 * One device; starts from the list cache when it is there so the page renders
 * instantly. `pollMs` adds polling for screens that wait for an upload, in
 * case the event stream is not connected. A device that is gone (goneDevices)
 * is never fetched again: its page may linger while the app navigates away.
 */
export function useDevice(deviceId: string, pollMs: number | false = false) {
  const queryClient = useQueryClient();
  return useQuery({
    enabled: () => !goneDevices.has(queryClient, deviceId),
    queryKey: queryKeys.device(deviceId),
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.devices.one(deviceId), deviceResponseSchema, { signal }),
    placeholderData: () => {
      const device = queryClient
        .getQueryData<DeviceListResponse>(queryKeys.devices)
        ?.devices.find((candidate) => candidate.id === deviceId);
      return device === undefined ? undefined : { device };
    },
    select: (response) => response.device,
    refetchInterval: pollMs,
  });
}
