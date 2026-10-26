import type { DeviceSummary } from "@trail/contracts/device";
import type { RemoteSettingsPreset } from "@trail/contracts/remoteSettings";
import { eq } from "drizzle-orm";
import type { AppContext } from "../appContext";
import { devices } from "../db/schema/devices";
import type { DeviceAccess } from "./deviceAccess";
import { findOwnedDevice } from "./findOwnedDevice";
import { loadDeviceSummary } from "./loadDeviceSummary";
import { publishDevice } from "./publishDevice";

export interface DeviceChanges {
  name?: string | undefined;
  alertsEnabled?: boolean | undefined;
  pendingSettings?: RemoteSettingsPreset | null | undefined;
}

/**
 * Renames a device, switches its alerts or queues a settings preset — never
 * its credentials — for the dashboard (`PATCH /api/devices/:id`) and the
 * public API (`PATCH /api/v1/devices/{id}`). Open dashboards get the new
 * summary at once.
 */
export async function changeDevice(
  ctx: AppContext,
  access: DeviceAccess,
  deviceId: string,
  changes: DeviceChanges,
): Promise<DeviceSummary> {
  const existing = await findOwnedDevice(ctx.db, access, deviceId);
  await ctx.db
    .update(devices)
    .set({
      ...(changes.name === undefined ? {} : { name: changes.name }),
      ...(changes.alertsEnabled === undefined ? {} : { alertsEnabled: changes.alertsEnabled }),
      // With alerts off there must be no "sending again" message later either.
      ...(changes.alertsEnabled === false ? { staleAlertedAt: null } : {}),
      ...(changes.pendingSettings === undefined
        ? {}
        : { pendingSettings: changes.pendingSettings }),
      updatedAt: new Date(),
    })
    .where(eq(devices.id, existing.id));
  const device = await loadDeviceSummary(ctx.db, access, existing.id);
  publishDevice(ctx, access.user.id, device);
  return device;
}
