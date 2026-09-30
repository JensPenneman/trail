import { useQuery } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { deviceListResponseSchema } from "@trail/contracts/device";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** The signed-in user's devices. Kept current by `device` / `device-removed` server events. */
export function useDevices() {
  return useQuery({
    queryKey: queryKeys.devices,
    queryFn: ({ signal }) => apiFetch(apiPaths.devices.root, deviceListResponseSchema, { signal }),
    select: (response) => response.devices,
  });
}
