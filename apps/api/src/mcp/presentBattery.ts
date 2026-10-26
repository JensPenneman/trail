import type { Battery } from "@trail/contracts/devicePublic";
import { formatInZone } from "./zonedTime";

/** A battery reading for an agent: the charge in percent and the time with the account's offset. */
export function presentBattery(battery: Battery | null, timeZone: string) {
  if (battery === null) return null;
  return {
    levelPercent: battery.level === null ? null : Math.round(battery.level * 100),
    state: battery.state,
    recordedAt: formatInZone(new Date(battery.recordedAt), timeZone),
  };
}
