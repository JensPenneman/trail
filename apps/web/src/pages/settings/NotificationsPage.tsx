import type { DeviceSummary } from "@trail/contracts/device";
import { useState } from "react";
import { useSessionUser } from "../../app/useSessionUser";
import { addDevicePath } from "../../devices/devicePaths";
import { useConfig } from "../../queries/useConfig";
import { useDevices } from "../../queries/useDevices";
import { useUpdateDevice } from "../../queries/useUpdateDevice";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { SettingsFact, SettingsRow } from "../../settings/SettingsRow";
import { ErrorState } from "../../ui/ErrorState";
import { LinkButton } from "../../ui/LinkButton";
import { LoadingBlock } from "../../ui/LoadingBlock";
import { Notice } from "../../ui/Notice";
import { Skeleton } from "../../ui/Skeleton";
import { useAnnounce } from "../../ui/useAnnounce";

const defaultStaleHours = 12;

/** One device's "it went silent" alert, switched on or off at once. */
function DeviceAlertRow({ device, available }: { device: DeviceSummary; available: boolean }) {
  const update = useUpdateDevice(device.id);
  const announce = useAnnounce();
  // Shown the moment it is switched, until the device's answer is in the list.
  const [pending, setPending] = useState<boolean | null>(null);
  return (
    <>
      <SettingsRow
        kind="switch"
        icon="devices"
        tone="blue"
        label={device.name}
        checked={pending ?? device.alertsEnabled}
        disabled={!available}
        onChange={(alertsEnabled) => {
          setPending(alertsEnabled);
          update.mutate(
            { alertsEnabled },
            {
              onSuccess: () =>
                announce(`Alerts for ${device.name} ${alertsEnabled ? "on" : "off"}.`),
              onSettled: () => setPending(null),
            },
          );
        }}
      />
      {update.isError ? (
        <li className="settings-row">
          <div className="settings-row__body">
            <ErrorState title={`The alert for ${device.name} was not saved`} error={update.error} />
          </div>
        </li>
      ) : null}
    </>
  );
}

/**
 * Settings › Notifications: whether this server can send alerts (ntfy) and,
 * per device, the alert when it goes silent and when it comes back.
 */
export function NotificationsPage() {
  const user = useSessionUser();
  const config = useConfig();
  const devices = useDevices();
  const available = config.data?.features.alerts === true;
  const staleHours = config.data?.thresholds.staleHours ?? defaultStaleHours;
  return (
    <SettingsPage page="notifications">
      {config.data === undefined ? null : (
        <SettingsGroup title="This server" variant="facts">
          <SettingsFact label="Alerts">
            {available ? "Sent through ntfy" : "Not set up"}
          </SettingsFact>
          <SettingsFact label="Silent after">{`${staleHours} hours without an upload`}</SettingsFact>
        </SettingsGroup>
      )}
      {config.data !== undefined && !available ? (
        <Notice tone="info" title="No alerts are sent">
          <p>
            This server has no notification channel (ALERT_NTFY_URL).{" "}
            {user.isAdmin
              ? "Set one in its environment to send alerts."
              : "Its administrator can set one up."}
          </p>
        </Notice>
      ) : null}
      {devices.isPending ? (
        <LoadingBlock label="Loading devices">
          <Skeleton height="4rem" />
        </LoadingBlock>
      ) : devices.isError ? (
        <ErrorState
          title="Devices could not be loaded"
          error={devices.error}
          onRetry={() => void devices.refetch()}
        />
      ) : (
        <SettingsGroup
          title="Device alerts"
          id="devices"
          footer={`A notification after ${staleHours} hours without an upload, and another when data arrives again.`}
        >
          {devices.data.length === 0 ? (
            <SettingsRow
              kind="plain"
              muted
              label="No devices yet."
              end={
                <LinkButton to={addDevicePath} variant="ghost" icon="plus">
                  Add a device
                </LinkButton>
              }
            />
          ) : (
            devices.data.map((device) => (
              <DeviceAlertRow key={device.id} device={device} available={available} />
            ))
          )}
        </SettingsGroup>
      )}
    </SettingsPage>
  );
}
