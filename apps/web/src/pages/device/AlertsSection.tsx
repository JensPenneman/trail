import type { DeviceSummary } from "@trail/contracts/device";
import { useConfig } from "../../queries/useConfig";
import { useUpdateDevice } from "../../queries/useUpdateDevice";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsRow } from "../../settings/SettingsRow";
import { ErrorState } from "../../ui/ErrorState";

interface AlertsSectionProps {
  device: DeviceSummary;
}

/** The "this phone went silent" notification (ntfy), per device; Settings › Notifications has it too. */
export function AlertsSection({ device }: AlertsSectionProps) {
  const config = useConfig();
  const update = useUpdateDevice(device.id);
  const staleHours = config.data?.thresholds.staleHours ?? 12;
  const available = config.data?.features.alerts === true;
  return (
    <SettingsGroup title="Alerts">
      <SettingsRow
        kind="switch"
        icon="bell"
        tone="red"
        label="Tell me when this device goes silent"
        detail={
          available
            ? `A notification after ${staleHours} hours without an upload, and another one when data arrives again.`
            : "This server has no notification channel configured (ALERT_NTFY_URL), so no alerts are sent."
        }
        checked={device.alertsEnabled}
        disabled={!available}
        busy={update.isPending}
        onChange={(alertsEnabled) => update.mutate({ alertsEnabled })}
      />
      {update.isError ? (
        <li className="settings-row">
          <div className="settings-row__body">
            <ErrorState title="The setting was not saved" error={update.error} />
          </div>
        </li>
      ) : null}
    </SettingsGroup>
  );
}
