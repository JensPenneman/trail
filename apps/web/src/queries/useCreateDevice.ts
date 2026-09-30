import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import {
  type CreateDeviceRequest,
  deviceWithCredentialsResponseSchema,
} from "@trail/contracts/device";
import { apiFetch } from "../api/apiFetch";
import { upsertDeviceInCache } from "../devices/upsertDeviceInCache";

/** Creates a device; the answer holds the one-time credentials for the phone. */
export function useCreateDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDeviceRequest) =>
      apiFetch(apiPaths.devices.root, deviceWithCredentialsResponseSchema, { body }),
    onSuccess: (response) => upsertDeviceInCache(queryClient, response.device),
  });
}
