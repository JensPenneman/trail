import type { PublicShareResponse } from "@trail/contracts/shareLink";
import { publicTrackMaxPoints } from "@trail/contracts/shareLink";
import { and, asc, eq, sql } from "drizzle-orm";
import type { AppContext } from "../appContext";
import { devices } from "../db/schema/devices";
import { shareLinks } from "../db/schema/shareLinks";
import { HttpError, notFound } from "../http/httpError";
import { hashToken } from "../lib/hashToken";
import { buildTrack } from "../tracks/buildTrack";
import { publicDeviceKey } from "./gridProjection";
import { isShareLinkSecret } from "./shareLinkSecret";
import { liveWindowMs, windowStart } from "./shareWindow";
import { toSharedDevice } from "./toSharedDevice";

const maxAccuracyM = 200;

/**
 * What a public link shows (docs/architecture.md §8.5): its label, expiry and
 * the owner's devices it names, at its precision — never the owner's account,
 * address or device ids. A secret of the wrong shape or an unknown one is
 * `not_found`; an expired or turned-off link `share_expired`, both 404. A
 * look counts as a view at most once a minute.
 */
export async function loadPublicShare(
  ctx: AppContext,
  secret: string,
): Promise<PublicShareResponse> {
  if (!isShareLinkSecret(secret)) throw notFound("This link does not exist.");
  const [link] = await ctx.db
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.tokenHash, hashToken(secret)))
    .limit(1);
  if (link === undefined) throw notFound("This link does not exist.");
  const now = new Date();
  if (link.revokedAt !== null || link.expiresAt.getTime() <= now.getTime()) {
    throw new HttpError(404, "share_expired", "This link has ended.");
  }

  const shown = await ctx.db
    .select()
    .from(devices)
    .where(
      and(
        eq(devices.userId, link.ownerUserId),
        link.deviceIds === null
          ? undefined
          : sql`${devices.id} = ANY(${sql.param(link.deviceIds)}::uuid[])`,
      ),
    )
    .orderBy(asc(devices.createdAt), asc(devices.id));
  const key = await ctx.sharing.gridKey();
  const from = windowStart(link.historyDays, now, liveWindowMs(ctx.config));
  const grant = { precision: link.precision, includeDetails: link.includeDetails };

  const result: PublicShareResponse = {
    label: link.label,
    expiresAt: link.expiresAt.toISOString(),
    precision: link.precision,
    historyDays: link.historyDays,
    devices: [],
  };
  for (const device of shown) {
    const { location, battery, activity } = toSharedDevice(device, grant, {
      key,
      from,
      viewerAt: null,
    });
    // History is precise only (the table's check): the track needs no projection.
    const track =
      link.historyDays === null || link.precision !== "precise"
        ? null
        : await ctx.sharing.publicTrack(link.id, device.id, async () => {
            const built = await buildTrack(ctx.db, device.id, {
              from,
              // A phone's clock runs a little ahead now and then; its newest points still count.
              to: new Date(now.getTime() + 86_400_000),
              maxAccuracy: maxAccuracyM,
              maxPoints: publicTrackMaxPoints,
            });
            return built.points;
          });
    result.devices.push({
      key: publicDeviceKey(key, link.id, device.id),
      name: device.name,
      location,
      battery,
      activity,
      track,
    });
  }

  ctx.background.run("count a share link view", async () => {
    await ctx.db.execute(sql`
      UPDATE share_links SET view_count = view_count + 1, last_viewed_at = now()
      WHERE id = ${link.id}
        AND (last_viewed_at IS NULL OR last_viewed_at < now() - interval '1 minute')
    `);
  });
  return result;
}
