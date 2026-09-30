import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { acknowledgementSchema } from "../api/acknowledgementSchema";
import { apiFetch } from "../api/apiFetch";
import { removeDeviceFromCache } from "../devices/removeDeviceFromCache";

/** Deletes a device together with every point, visit and trip it recorded. */
export function useDeleteDevice(deviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch(apiPaths.devices.one(deviceId), acknowledgementSchema, { method: "DELETE" }),
    onSuccess: () => removeDeviceFromCache(queryClient, deviceId),
  });
}
