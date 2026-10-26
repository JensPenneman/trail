import type { DeviceMode } from "@trail/contracts/transport";
import { loadDeviceMode } from "../transport/deviceMode";
import type { WorkContext } from "./runMcpWork";
import { formatInZone } from "./zonedTime";

/** A device's mode now (`loadDeviceMode`) as answers carry it: no segment id, nothing to locate. */
export function presentCurrentMode(mode: DeviceMode, timeZone: string) {
  if (mode.current === null) return null;
  return {
    mode: mode.current.mode,
    setByUser: mode.current.setByUser,
    since: formatInZone(new Date(mode.current.since), timeZone),
  };
}

/**
 * How the device travels now, as the dashboard's quick toggle shows it: the
 * mode set from a moment on, or the latest segment's while it is recent.
 */
export async function currentModeOf(context: WorkContext, deviceId: string) {
  const mode = await loadDeviceMode(context.db, context.principal, deviceId, {
    now: context.now,
    recentMs: context.ctx.config.liveWindowMinutes * 60_000,
  });
  return presentCurrentMode(mode, context.timeZone);
}
