import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { deviceResponseSchema, type UpdateDeviceRequest } from "@trail/contracts/device";
import { apiFetch } from "../api/apiFetch";
import { upsertDeviceInCache } from "../devices/upsertDeviceInCache";

/** Rename, toggle alerts, or queue / cancel a remote-settings preset. */
export function useUpdateDevice(deviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateDeviceRequest) =>
      apiFetch(apiPaths.devices.one(deviceId), deviceResponseSchema, { method: "PATCH", body }),
    onSuccess: (response) => upsertDeviceInCache(queryClient, response.device),
  });
}
