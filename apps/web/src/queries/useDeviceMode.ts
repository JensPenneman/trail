import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { deviceModeResponseSchema } from "@trail/contracts/transport";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** How a device travels now: the quick toggle in force and the current mode. */
export function useDeviceMode(deviceId: string) {
  return useQuery({
    queryKey: queryKeys.deviceMode(deviceId),
    queryFn: ({ signal }) =>
      apiFetch(apiPaths.v1.devices.mode(deviceId), deviceModeResponseSchema, { signal }),
    select: (response) => response.mode,
  });
}
