import { devicePath } from "../../devices/devicePaths";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { EmptyState } from "../../ui/EmptyState";
import { LinkButton } from "../../ui/LinkButton";
import { DevicePartPage } from "./DevicePartPage";
import { RemoteSettingsSection } from "./RemoteSettingsSection";

/**
 * Settings › Devices › a device › Tracking settings: Overland's presets, sent
 * with the phone's next upload. No other app takes them; its address says so.
 */
export function DeviceTrackingPage() {
  return (
    <DevicePartPage part="tracking">
      {(device) =>
        device.source === "overland" ? (
          <RemoteSettingsSection key={device.pendingSettings ?? "none"} device={device} />
        ) : (
          <SettingsGroup variant="card">
            <EmptyState
              icon="settings"
              title="Only Overland takes tracking settings from Trail"
              action={
                <LinkButton to={devicePath(device.id)} icon="arrowLeft">
                  {device.name}
                </LinkButton>
              }
            >
              <p>Change how {device.name} records in its app on the phone.</p>
            </EmptyState>
          </SettingsGroup>
        )
      }
    </DevicePartPage>
  );
}
