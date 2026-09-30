import type { Alert } from "./alert";

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatLocal = (instant: Date, timeZone: string): string => {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter.format(instant);
};

interface AlertDevice {
  name: string;
  ownerName: string;
}

/** "<device> has sent nothing for 12 h — last upload …" */
export function silentDeviceAlert(
  device: AlertDevice & { lastSeenAt: Date; timezone: string },
  staleAfterHours: number,
): Alert {
  return {
    title: `${device.name} is silent`,
    message: `${device.name} (${device.ownerName}) has sent nothing for ${staleAfterHours} h — last upload ${formatLocal(device.lastSeenAt, device.timezone)}.`,
    tags: ["warning"],
    priority: "high",
  };
}

/** Sent with the first upload after a silence alert. */
export function recoveredDeviceAlert(device: AlertDevice): Alert {
  return {
    title: `${device.name} is back`,
    message: `${device.name} (${device.ownerName}) is sending data again.`,
    tags: ["white_check_mark"],
    priority: "default",
  };
}
