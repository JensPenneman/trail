import type { DeviceSummary } from "@trail/contracts/device";
import { deviceAppInfo } from "@trail/contracts/deviceApp";
import type { RemoteSettingsPreset } from "@trail/contracts/remoteSettings";
import { eq } from "drizzle-orm";
import type { AppContext } from "../appContext";
import { devices } from "../db/schema/devices";
import { HttpError } from "../http/httpError";
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
 * its credentials or its app — for the dashboard (`PATCH /api/devices/:id`)
 * and the public API (`PATCH /api/v1/devices/{id}`). A preset is for Overland
 * only: it travels in Overland's answer to an upload, and no other app takes
 * settings from Trail (409). Open dashboards get the new summary at once.
 */
export async function changeDevice(
  ctx: AppContext,
  access: DeviceAccess,
  deviceId: string,
  changes: DeviceChanges,
): Promise<DeviceSummary> {
  const existing = await findOwnedDevice(ctx.db, access, deviceId);
  if (
    changes.pendingSettings !== undefined &&
    changes.pendingSettings !== null &&
    existing.source !== "overland"
  ) {
    throw new HttpError(
      409,
      "conflict",
      `Settings presets are for Overland only; ${deviceAppInfo[existing.source].name} takes its settings in the app.`,
    );
  }
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
