import type { Person } from "@trail/contracts/person";
import { sharePrecisions } from "@trail/contracts/share";
import { inArray, sql } from "drizzle-orm";
import type { AppContext } from "../appContext";
import { devices } from "../db/schema/devices";
import { toIso, toIsoOrNull } from "../db/toIso";
import { allowedDeviceIds } from "../devices/deviceAccess";
import {
  grantsViewer,
  mayReadPeople,
  resolveAccessibleDevices,
  type Viewer,
} from "./accessibleDevices";
import { latestOwnPositions } from "./latestOwnPositions";
import { mayReadOwnLocations } from "./mayReadOwnLocations";
import { toSharedDevice } from "./toSharedDevice";
import { touchShareViews } from "./touchShareViews";

interface PersonRow extends Record<string, unknown> {
  id: string;
  owner_user_id: string;
  precision: string;
  history_days: number | null;
  include_details: boolean;
  expires_at: string | null;
  created_at: string;
  display_name: string;
  email: string;
}

/**
 * The people who share with the viewer — or one of them — with their shared
 * devices at the precision of their shares (docs/architecture.md §8.4). A
 * person whose share covers no device yet is listed with none. Looking
 * stamps the shares' `last_viewed_at`.
 */
export async function loadPeople(
  ctx: AppContext,
  viewer: Viewer,
  onlyUserId?: string,
): Promise<Person[]> {
  if (!mayReadPeople(viewer)) return [];
  const now = new Date();
  const { rows } = await ctx.db.execute<PersonRow>(sql`
    SELECT s.id, s.owner_user_id, s.precision, s.history_days, s.include_details, s.expires_at,
      s.created_at, u.display_name, u.email
    FROM shares s
    JOIN users u ON u.id = s.owner_user_id
    WHERE ${grantsViewer(viewer.user.id, now)}
      ${onlyUserId === undefined ? sql`` : sql`AND s.owner_user_id = ${onlyUserId}`}
    ORDER BY lower(u.display_name), u.id
  `);
  if (rows.length === 0) return [];

  const shareIds = new Set(rows.map((row) => row.id));
  const accessible = (
    await resolveAccessibleDevices(ctx, viewer, undefined, { now, ownDevices: false })
  ).filter((device) => device.shareId !== null && shareIds.has(device.shareId));
  const deviceRows =
    accessible.length === 0
      ? []
      : await ctx.db
          .select()
          .from(devices)
          .where(
            inArray(
              devices.id,
              accessible.map((device) => device.deviceId),
            ),
          );
  const byId = new Map(deviceRows.map((device) => [device.id, device]));
  const key = await ctx.sharing.gridKey();
  const viewerAt = mayReadOwnLocations(viewer)
    ? ((await latestOwnPositions(ctx.db, [viewer.user.id], allowedDeviceIds(viewer))).get(
        viewer.user.id,
      ) ?? null)
    : null;

  const people = rows.map((row): Person => {
    const precision = sharePrecisions.find((value) => value === row.precision) ?? "area";
    return {
      userId: row.owner_user_id,
      displayName: row.display_name,
      email: row.email,
      share: {
        id: row.id,
        precision,
        historyDays: row.history_days,
        includeDetails: row.include_details,
        expiresAt: toIsoOrNull(row.expires_at),
        createdAt: toIso(row.created_at),
      },
      devices: accessible.flatMap((access) => {
        const device = byId.get(access.deviceId);
        if (access.shareId !== row.id || access.from === null || device === undefined) return [];
        return [
          toSharedDevice(
            device,
            { precision, includeDetails: access.includeDetails },
            { key, from: access.from, viewerAt },
          ),
        ];
      }),
    };
  });
  touchShareViews(
    ctx,
    rows.map((row) => row.id),
  );
  return people;
}
