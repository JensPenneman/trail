import type { DeviceSummary } from "@trail/contracts/device";
import type { DeviceStatus } from "@trail/contracts/deviceStatus";
import { Link } from "react-router";
import { useFormatter } from "../../format/useFormatter";
import { BatteryIndicator } from "../../ui/BatteryIndicator";
import { DeviceSwatch } from "../../ui/DeviceSwatch";
import { Icon } from "../../ui/Icon";
import { RelativeTime } from "../../ui/RelativeTime";
import { StatusBadge } from "../../ui/StatusBadge";
import "./DeviceRow.css";

interface DeviceRowProps {
  device: DeviceSummary;
  status: DeviceStatus;
  thresholds: { liveMinutes: number; staleHours: number };
  colorSlot: number;
}

/** One device in the list; the whole row links to its page. */
export function DeviceRow({ device, status, thresholds, colorSlot }: DeviceRowProps) {
  const format = useFormatter();
  return (
    <li className="device-row">
      <Link to={`/devices/${device.id}`} className="device-row__link">
        <DeviceSwatch slot={colorSlot} />
        <div className="device-row__main">
          <p className="device-row__name">{device.name}</p>
          <p className="device-row__meta">
            {device.lastSeenAt === null ? (
              "No upload yet"
            ) : (
              <>
                Last upload <RelativeTime value={device.lastSeenAt} tickMs={15_000} />
              </>
            )}
            <span aria-hidden="true"> · </span>
            {format.count(device.counts.total)} points
            <span aria-hidden="true"> · </span>
            <span className="mono">{device.deviceKey}</span>
          </p>
        </div>
        <div className="device-row__side">
          <StatusBadge status={status} thresholds={thresholds} />
          {device.battery === null ? null : <BatteryIndicator battery={device.battery} />}
        </div>
        <Icon name="chevronRight" className="device-row__chevron" />
      </Link>
    </li>
  );
}
