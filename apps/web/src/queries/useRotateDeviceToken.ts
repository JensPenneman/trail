import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { deviceWithCredentialsResponseSchema } from "@trail/contracts/device";
import { apiFetch } from "../api/apiFetch";
import { upsertDeviceInCache } from "../devices/upsertDeviceInCache";

/** Issues a new access token; the old one stops working immediately. */
export function useRotateDeviceToken(deviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch(apiPaths.devices.token(deviceId), deviceWithCredentialsResponseSchema, {
        method: "POST",
      }),
    onSuccess: (response) => upsertDeviceInCache(queryClient, response.device),
  });
}
