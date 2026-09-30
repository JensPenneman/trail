import { type DeviceStatus, deviceStatus } from "@trail/contracts/deviceStatus";
import { useEffect, useRef } from "react";
import { useConfig } from "../queries/useConfig";
import { useDevices } from "../queries/useDevices";
import { useNow } from "../time/useNow";
import { useAnnounce } from "../ui/useAnnounce";

/**
 * Tells screen reader users when a device goes silent or comes back — the
 * changes that matter. Routine live ⇄ idle flips (every time a phone stands
 * still) stay quiet.
 */
export function useDeviceStatusAnnouncements(): void {
  const { data: devices } = useDevices();
  const { data: config } = useConfig();
  const now = useNow(15_000);
  const announce = useAnnounce();
  const previous = useRef<ReadonlyMap<string, DeviceStatus> | null>(null);

  useEffect(() => {
    if (devices === undefined || config === undefined) return;
    const current = new Map<string, DeviceStatus>();
    const messages: string[] = [];
    for (const device of devices) {
      const status = deviceStatus(device.lastSeenAt, new Date(now), config.thresholds);
      current.set(device.id, status);
      const before = previous.current?.get(device.id);
      if (before === undefined || before === status) continue;
      if (status === "stale") messages.push(`${device.name} has gone silent.`);
      else if (before === "never") messages.push(`${device.name} sent its first upload.`);
      else if (before === "stale") messages.push(`${device.name} is sending data again.`);
    }
    previous.current = current;
    if (messages.length > 0) announce(messages.join(" "));
  }, [devices, config, now, announce]);
}
