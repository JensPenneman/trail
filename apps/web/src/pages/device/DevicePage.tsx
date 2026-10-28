import { deviceStatus } from "@trail/contracts/deviceStatus";
import { useState } from "react";
import { devicePath } from "../../devices/devicePaths";
import { useDeviceColors } from "../../devices/useDeviceColors";
import { useFormatter } from "../../format/useFormatter";
import { useConfig } from "../../queries/useConfig";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsPage } from "../../settings/SettingsPage";
import { SettingsRow } from "../../settings/SettingsRow";
import { type SettingsPartId, settingsPart } from "../../settings/settingsTree";
import { useNow } from "../../time/useNow";
import { DeviceSwatch } from "../../ui/DeviceSwatch";
import { RelativeTime } from "../../ui/RelativeTime";
import { StatusBadge } from "../../ui/StatusBadge";
import { ActivitySection } from "./ActivitySection";
import { AlertsSection } from "./AlertsSection";
import { DeleteDeviceDialog } from "./DeleteDeviceDialog";
import { DeviceOverview } from "./DeviceOverview";
import { DeviceUnavailable } from "./DeviceUnavailable";
import { RenameDeviceDialog } from "./RenameDeviceDialog";
import { RotateTokenDialog } from "./RotateTokenDialog";
import { TravelModeSection } from "./TravelModeSection";
import { useRoutedDevice } from "./useRoutedDevice";
import "./DevicePage.css";

const defaultThresholds = { liveMinutes: 15, staleHours: 12 };

type OpenDialog = "rename" | "rotate" | "delete" | null;

/**
 * Settings › Devices › one device: its state and activity, how it travels
 * now, its alert, the way to what it uploaded (uploads, raw points) and to how
 * it is set up (tracking settings, setup), a level deeper, and everything that
 * can be changed about it — its name, its token, whether it exists.
 */
export function DevicePage() {
  const { deviceId, device } = useRoutedDevice();
  const config = useConfig();
  const colors = useDeviceColors();
  const format = useFormatter();
  const now = useNow(15_000);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const thresholds = config.data?.thresholds ?? defaultThresholds;

  if (device.data === undefined) return <DeviceUnavailable deviceId={deviceId} device={device} />;

  const current = device.data;
  const status = deviceStatus(current.lastSeenAt, new Date(now), thresholds);
  const part = (id: SettingsPartId) => ({
    to: devicePath(current.id, id),
    label: settingsPart(id).label,
    detail: settingsPart(id).description,
  });

  return (
    <SettingsPage
      parent="devices"
      title={current.name}
      description={
        <span className="device-page__status">
          <DeviceSwatch slot={colors.slot(current.id)} />
          <StatusBadge status={status} thresholds={thresholds} />
          {current.lastSeenAt === null ? (
            <span>No upload yet</span>
          ) : (
            <span>
              Last upload <RelativeTime value={current.lastSeenAt} />
            </span>
          )}
        </span>
      }
    >
      <DeviceOverview device={current} live={status === "live"} />
      <ActivitySection
        deviceId={current.id}
        deviceName={current.name}
        colorSlot={colors.slot(current.id)}
      />
      {current.lastSeenAt === null ? null : <TravelModeSection device={current} />}
      <AlertsSection device={current} />

      <SettingsGroup title="What it sent">
        <SettingsRow kind="link" icon="upload" tone="green" {...part("uploads")} />
        <SettingsRow
          kind="link"
          icon="pin"
          tone="orange"
          {...part("points")}
          value={format.count(current.counts.total)}
        />
        <SettingsRow
          kind="away"
          to={`/?view=history&devices=${encodeURIComponent(current.id)}`}
          icon="history"
          tone="indigo"
          label="History"
          detail="Where it has been, day by day, on the map."
        />
      </SettingsGroup>

      <SettingsGroup title="The phone">
        {/* Settings presets travel in Overland's answers; no other app takes them. */}
        {current.source === "overland" ? (
          <SettingsRow
            kind="link"
            icon="settings"
            tone="gray"
            {...part("tracking")}
            value={current.pendingSettings === null ? undefined : "Queued"}
          />
        ) : null}
        <SettingsRow kind="link" icon="qr" tone="blue" {...part("setup")} />
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow kind="action" label="Rename" onClick={() => setDialog("rename")} />
      </SettingsGroup>

      <SettingsGroup
        footer={`For a lost token, a phone that changed hands or another app on the phone. The current one (…${current.tokenHint}) stops working.`}
      >
        <SettingsRow kind="action" label="Issue new token" onClick={() => setDialog("rotate")} />
      </SettingsGroup>
      <SettingsGroup footer="Removes the device and every point it recorded.">
        <SettingsRow
          kind="action"
          danger
          label="Delete device"
          onClick={() => setDialog("delete")}
        />
      </SettingsGroup>

      <RenameDeviceDialog
        device={current}
        open={dialog === "rename"}
        onClose={() => setDialog(null)}
      />
      <RotateTokenDialog
        key={current.source}
        device={current}
        open={dialog === "rotate"}
        onClose={() => setDialog(null)}
      />
      <DeleteDeviceDialog
        device={current}
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
      />
    </SettingsPage>
  );
}
