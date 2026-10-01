import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPaths } from "@trail/contracts/apiPaths";
import { useNavigate } from "react-router";
import { acknowledgementSchema } from "../api/acknowledgementSchema";
import { apiFetch } from "../api/apiFetch";
import { queryKeys } from "../api/queryKeys";
import { goneDevices } from "../devices/goneDevices";
import { removeDeviceFromCache } from "../devices/removeDeviceFromCache";
import { useAnnounce } from "../ui/useAnnounce";

/**
 * Deletes a device together with every point, visit and trip it recorded, and
 * leaves for the device list. The page goes first: forgetting the device while
 * its page is shown would unmount the dialog that started this (so nothing
 * would navigate) and have the page ask the server for the gone device.
 */
export function useDeleteDevice(device: { id: string; name: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const announce = useAnnounce();
  return useMutation({
    mutationKey: queryKeys.deleteDevice(device.id),
    // gone for this tab's queries the moment the deletion starts (see goneDevices)
    onMutate: () => goneDevices.mark(queryClient, device.id),
    mutationFn: () =>
      apiFetch(apiPaths.devices.one(device.id), acknowledgementSchema, { method: "DELETE" }),
    onError: () => goneDevices.unmark(queryClient, device.id),
    onSuccess: async () => {
      await navigate("/devices", { replace: true });
      removeDeviceFromCache(queryClient, device.id);
      announce(`${device.name} was deleted.`);
    },
  });
}
