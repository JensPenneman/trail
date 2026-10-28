import type { DeviceSummary } from "@trail/contracts/device";
import type { AppContext } from "../appContext";
import { loadDeviceSummaries } from "./loadDeviceSummaries";

/** Pushes a `device` event with a fresh summary to the owner's live streams. */
export function publishDevice(ctx: AppContext, userId: string, device: DeviceSummary): void {
  ctx.bus.publish(userId, { type: "device", device });
}

/**
 * Reloads a summary and publishes it after the response (e.g. after an
 * upload) — also while the owner's stream is away for a moment, which gets it
 * when it comes back (docs/architecture.md §9).
 */
export function publishDeviceLater(ctx: AppContext, userId: string, deviceId: string): void {
  if (!ctx.bus.follows(userId)) return;
  ctx.background.run("publish device summary", async () => {
    const [device] = await loadDeviceSummaries(ctx.db, { user: { id: userId } }, deviceId);
    if (device !== undefined) publishDevice(ctx, userId, device);
  });
}
