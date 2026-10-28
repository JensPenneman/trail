import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { deviceModeResponseSchema } from "@trail/contracts/transport";
import { queryKeys } from "../api/queryKeys";
import { cachedFetch } from "../cache/cachedFetch";
import { goneDevices } from "../devices/goneDevices";

/**
 * How a device travels now: the quick toggle in force and the current mode.
 * Null asks for nothing, and neither does a device this tab knows is gone.
 */
export function useDeviceMode(deviceId: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.deviceMode(deviceId ?? ""),
    queryFn: ({ client, queryKey, signal }) =>
      cachedFetch(
        { client, queryKey, signal },
        apiPaths.v1.devices.mode(deviceId ?? ""),
        deviceModeResponseSchema,
      ),
    enabled: () => deviceId !== null && !goneDevices.has(queryClient, deviceId),
    select: (response) => response.mode,
  });
}
