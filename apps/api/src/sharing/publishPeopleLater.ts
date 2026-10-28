import { and, eq } from "drizzle-orm";
import type { AppContext } from "../appContext";
import { devices } from "../db/schema/devices";
import { currentModeRecentMs, loadCurrentModes } from "./currentModes";
import { latestOwnPositions } from "./latestOwnPositions";
import { coversDevice, liveWindowMs, windowStart } from "./shareWindow";
import { toSharedDevice } from "./toSharedDevice";

/**
 * After an upload: a `person` event with the device as each recipient's share
 * shows it, to every recipient with a live stream whose share is in force,
 * covers the device and is not hidden (docs/architecture.md §9). The owner's
 * shares come from the one-minute cache that every change clears. Each push
 * counts in the owner's data access log (§8.8): per recipient, device and
 * hour, with how many there were.
 */
export function publishPeopleLater(ctx: AppContext, ownerId: string, deviceId: string): void {
  ctx.background.run("publish shared position", async () => {
    const now = new Date();
    const inForce = (await ctx.sharing.sharesOf(ownerId, now.getTime())).filter(
      (share) =>
        share.hiddenAt === null &&
        (share.expiresAt === null || share.expiresAt.getTime() > now.getTime()) &&
        coversDevice(share.deviceIds, deviceId),
    );
    // A position goes to an open page only, and counts as a look there: a recipient whose
    // stream is away for a moment resyncs when it comes back rather than miss it (§9).
    for (const share of inForce) {
      if (ctx.bus.connectionCount(share.recipientUserId) === 0) ctx.bus.miss(share.recipientUserId);
    }
    const receiving = inForce.filter((share) => ctx.bus.connectionCount(share.recipientUserId) > 0);
    if (receiving.length === 0) return;
    const [device] = await ctx.db
      .select()
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.userId, ownerId)))
      .limit(1);
    if (device === undefined) return;
    const key = await ctx.sharing.gridKey();
    const positions = await latestOwnPositions(
      ctx.db,
      receiving.map((share) => share.recipientUserId),
    );
    const live = liveWindowMs(ctx.config);
    const modes = await loadCurrentModes(
      ctx.db,
      receiving.some((share) => share.includeDetails) ? [device.id] : [],
      { now, recentMs: currentModeRecentMs(ctx.config) },
    );
    for (const share of receiving) {
      ctx.dataAccess.record({
        ownerUserId: ownerId,
        channel: "live",
        actor: {
          kind: "person",
          userId: share.recipientUserId,
          shareId: share.id,
          label: share.recipientName,
        },
        action: "live.position",
        access: "read",
        resource: { deviceIds: [device.id], precision: share.precision },
        status: 200,
        at: now,
      });
      ctx.bus.publish(share.recipientUserId, {
        type: "person",
        userId: ownerId,
        device: toSharedDevice(
          device,
          { precision: share.precision, includeDetails: share.includeDetails },
          {
            key,
            from: windowStart(share.historyDays, now, live),
            viewerAt: positions.get(share.recipientUserId) ?? null,
            modes,
          },
        ),
      });
    }
  });
}
