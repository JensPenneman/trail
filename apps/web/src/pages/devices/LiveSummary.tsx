import type { DeviceSummary } from "@trail/contracts/device";
import type { DeviceStatus } from "@trail/contracts/deviceStatus";
import { RelativeTime } from "../../ui/RelativeTime";

interface LiveSummaryProps {
  devices: readonly DeviceSummary[];
  statuses: ReadonlyMap<string, DeviceStatus>;
}

/** Under the Devices page's title: how many devices are live, and the latest upload of any. */
export function LiveSummary({ devices, statuses }: LiveSummaryProps) {
  const live = [...statuses.values()].filter((status) => status === "live").length;
  const latest = devices.reduce<DeviceSummary | null>((newest, device) => {
    if (device.lastSeenAt === null) return newest;
    if (newest?.lastSeenAt == null) return device;
    return Date.parse(device.lastSeenAt) > Date.parse(newest.lastSeenAt) ? device : newest;
  }, null);
  return (
    <p className="devices-page__live">
      <span>
        {live} of {devices.length} {devices.length === 1 ? "device" : "devices"} live
      </span>
      {latest?.lastSeenAt == null ? null : (
        <>
          {" · last upload "}
          <RelativeTime value={latest.lastSeenAt} />
        </>
      )}
    </p>
  );
}
