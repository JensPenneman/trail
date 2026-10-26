import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { type ChosenMode, deviceModeResponseSchema } from "@trail/contracts/transport";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";

/** The quick toggle: a mode from now on, or null for automatic again. */
export function useSetDeviceMode(deviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mode: ChosenMode | null) =>
      apiFetch(apiPaths.v1.devices.mode(deviceId), deviceModeResponseSchema, { body: { mode } }),
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.deviceMode(deviceId), response);
    },
  });
}
