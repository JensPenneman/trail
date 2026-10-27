import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import {
  deviceWithCredentialsResponseSchema,
  type RotateDeviceTokenRequest,
} from "@trail/contracts/device";
import { apiFetch } from "../api/apiFetch";
import { upsertDeviceInCache } from "../devices/upsertDeviceInCache";

/**
 * Issues a new access token, and with `source` moves the device to another
 * app; the old token stops working immediately.
 */
export function useRotateDeviceToken(deviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RotateDeviceTokenRequest) =>
      apiFetch(apiPaths.devices.token(deviceId), deviceWithCredentialsResponseSchema, {
        method: "POST",
        body,
      }),
    onSuccess: (response) => upsertDeviceInCache(queryClient, response.device),
  });
}
