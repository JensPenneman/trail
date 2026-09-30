import type { DeviceStatus } from "@trail/contracts/deviceStatus";
import type { IconName } from "../ui/iconPaths";

export interface StatusPresentation {
  label: string;
  icon: IconName;
  /** What the status means, with the server's thresholds filled in. */
  description: string;
}

/** Wording for each freshness state; the badge never relies on colour alone. */
export function statusPresentation(
  status: DeviceStatus,
  thresholds: { liveMinutes: number; staleHours: number },
): StatusPresentation {
  switch (status) {
    case "live":
      return {
        label: "Live",
        icon: "live",
        description: `Uploaded within the last ${thresholds.liveMinutes} minutes.`,
      };
    case "idle":
      return {
        label: "Idle",
        icon: "pause",
        description: `Uploaded within the last ${thresholds.staleHours} hours. Normal while the phone stands still: Overland pauses to save battery.`,
      };
    case "stale":
      return {
        label: "Silent",
        icon: "warning",
        description: `Nothing for more than ${thresholds.staleHours} hours. Tracking has probably stopped on the phone.`,
      };
    case "never":
      return {
        label: "No data yet",
        icon: "upload",
        description: "The device has not uploaded anything yet.",
      };
  }
}
