import type { DeviceSummary } from "@trail/contracts/device";
import { deviceAppInfo } from "@trail/contracts/deviceApp";
import { describeMovement } from "../../devices/describeMovement";
import { tripModeLabel } from "../../devices/tripModeLabel";
import { useFormatter } from "../../format/useFormatter";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { SettingsFact } from "../../settings/SettingsRow";
import { BatteryIndicator } from "../../ui/BatteryIndicator";
import { RelativeTime } from "../../ui/RelativeTime";

interface DeviceOverviewProps {
  device: DeviceSummary;
  /** Whether the device is live: otherwise its movement is only what it last reported. */
  live: boolean;
}

/** The device's latest state as label/value pairs. */
export function DeviceOverview({ device, live }: DeviceOverviewProps) {
  const format = useFormatter();
  const location = device.lastLocation;
  const movement = describeMovement(location, format);
  return (
    <SettingsGroup title="Overview" variant="facts">
      <SettingsFact label="Last upload">
        {device.lastSeenAt === null ? (
          "Never"
        ) : (
          <>
            <RelativeTime value={device.lastSeenAt} />
            <span className="muted"> · {format.dateTime(device.lastSeenAt)}</span>
          </>
        )}
      </SettingsFact>
      <SettingsFact label="Last position">
        {location === null ? (
          "—"
        ) : (
          <>
            {format.coordinates(location.lat, location.lon)}
            <span className="muted">
              {location.accuracy === null ? "" : ` ${format.accuracy(location.accuracy)}`} ·{" "}
              {format.dateTime(location.recordedAt)}
            </span>
          </>
        )}
      </SettingsFact>
      <SettingsFact label={live ? "Movement" : "Last reported movement"}>
        {movement ?? "—"}
      </SettingsFact>
      <SettingsFact label="Altitude">
        {location?.altitude == null ? "—" : format.metres(location.altitude)}
      </SettingsFact>
      <SettingsFact label="Battery">
        <BatteryIndicator battery={device.battery} />
      </SettingsFact>
      <SettingsFact label="Trip">
        {device.liveTrip === null
          ? "None in progress"
          : `${tripModeLabel(device.liveTrip.mode)} since ${format.time(device.liveTrip.startedAt)} · ${format.distance(device.liveTrip.distanceM)}`}
      </SettingsFact>
      <SettingsFact label="Points">
        {format.count(device.counts.today)} today · {format.count(device.counts.last24h)} in 24 h ·{" "}
        {format.count(device.counts.total)} in total
      </SettingsFact>
      <SettingsFact label="App">{deviceAppInfo[device.source].name}</SettingsFact>
      {/* The other apps have no use for the device key. */}
      {device.source === "overland" || device.source === "owntracks" ? (
        <SettingsFact label="Device ID">
          <span className="mono">{device.deviceKey}</span>
        </SettingsFact>
      ) : null}
      <SettingsFact label="Access token">
        <span className="mono">…{device.tokenHint}</span>
      </SettingsFact>
      <SettingsFact label="Added">{format.dateTime(device.createdAt)}</SettingsFact>
    </SettingsGroup>
  );
}
