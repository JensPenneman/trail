import { type UseQueryResult, useQueryClient } from "@tanstack/react-query";
import type { DeviceSummary } from "@trail/contracts/device";
import { ApiError } from "../../api/ApiError";
import { devicePath } from "../../devices/devicePaths";
import { goneDevices } from "../../devices/goneDevices";
import { SettingsPage } from "../../settings/SettingsPage";
import { type SettingsPartId, settingsPart } from "../../settings/settingsTree";
import { ErrorState } from "../../ui/ErrorState";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Skeleton } from "../../ui/Skeleton";
import { MissingItem } from "../settings/MissingItem";

interface DeviceUnavailableProps {
  deviceId: string;
  device: UseQueryResult<DeviceSummary>;
  /** The page of a part of the device (its uploads, …); its own page without. */
  part?: SettingsPartId;
}

/**
 * A device's page, or the page of a part of it, before its device is there:
 * while it loads, when it cannot be loaded, and when there is no such device
 * (deleted, here or elsewhere, or the address of another account's).
 */
export function DeviceUnavailable({ deviceId, device, part }: DeviceUnavailableProps) {
  const queryClient = useQueryClient();
  const missing =
    (device.error instanceof ApiError && device.error.status === 404) ||
    goneDevices.has(queryClient, deviceId);
  if (missing) return <MissingItem parent="devices" item="Device" />;
  return (
    <SettingsPage
      parent="devices"
      {...(part === undefined
        ? { title: "Device" }
        : {
            title: settingsPart(part).label,
            item: { path: devicePath(deviceId), label: "Device" },
          })}
    >
      {device.isPending ? (
        <LoadingBlock label="Loading the device">
          <Skeleton height="10rem" />
          <Skeleton height="6rem" />
        </LoadingBlock>
      ) : (
        <ErrorState
          title="The device could not be loaded"
          error={device.error}
          onRetry={() => void device.refetch()}
          retrying={device.isFetching}
        />
      )}
    </SettingsPage>
  );
}
