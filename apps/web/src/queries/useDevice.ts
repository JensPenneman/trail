import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { type DeviceListResponse, deviceResponseSchema } from "@trail/contracts/device";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/**
 * One device; starts from the list cache when it is there so the page renders
 * instantly. `pollMs` adds polling for screens that wait for an upload, in
 * case the event stream is not connected.
 */
export function useDevice(deviceId: string, pollMs: number | false = false) {
  const queryClient = useQueryClient();
  return useQuery({
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
