import type { DeviceSummary } from "@trail/contracts/device";
import type { AppContext } from "../appContext";
import { loadDeviceSummaries } from "./loadDeviceSummaries";

/** Pushes a `device` event with a fresh summary to the owner's live streams. */
export function publishDevice(ctx: AppContext, userId: string, device: DeviceSummary): void {
  ctx.bus.publish(userId, { type: "device", device });
}

/** Reloads a summary and publishes it after the response (e.g. after an upload). */
export function publishDeviceLater(ctx: AppContext, userId: string, deviceId: string): void {
  if (ctx.bus.connectionCount(userId) === 0) return;
  ctx.background.run("publish device summary", async () => {
    const [device] = await loadDeviceSummaries(ctx.db, { userId, deviceId });
    if (device !== undefined) publishDevice(ctx, userId, device);
  });
}
