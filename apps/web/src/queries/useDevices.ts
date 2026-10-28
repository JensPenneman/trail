import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { deviceListResponseSchema } from "@trail/contracts/device";
import { queryKeys } from "../api/queryKeys";
import { cachedFetch } from "../cache/cachedFetch";

/** The signed-in user's devices. Kept current by `device` / `device-removed` server events. */
export function useDevices() {
  return useQuery({
    queryKey: queryKeys.devices,
    queryFn: ({ client, queryKey, signal }) =>
      cachedFetch({ client, queryKey, signal }, apiPaths.devices.root, deviceListResponseSchema),
    select: (response) => response.devices,
  });
}
