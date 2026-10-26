import type { ApiScope } from "@trail/contracts/apiScope";
import { type SharePrecision, sharePrecisions } from "@trail/contracts/share";
import { type SQL, sql } from "drizzle-orm";
import type { Executor } from "../db/database";
import { allowedDeviceIds, type DeviceAccess } from "../devices/deviceAccess";
import { notFound } from "../http/httpError";
import { mayReadOwnLocations } from "./mayReadOwnLocations";
import { liveWindowMs, windowStart } from "./shareWindow";

/**
 * Who looks: the principal of a request — a token may lack `people:read` or
 * be limited to some of its user's devices — or `{ user: { id } }` for work
 * done on a user's behalf (the live events).
 */
export type Viewer = DeviceAccess & {
  readonly kind?: "session" | "token";
  readonly scopes?: readonly ApiScope[];
};

/** A device the viewer may see, and how (docs/architecture.md §8.5). */
export interface AccessibleDevice {
  deviceId: string;
  ownerId: string;
  /** The share that grants it; null for the viewer's own devices. */
  shareId: string | null;
  /** Own devices are precise; shared ones as their share says. */
  precision: SharePrecision;
  /** Days of history the share includes; null for live-only shares and for own devices. */
  historyDays: number | null;
  /** Nothing recorded before this may be shown; null for own devices (no bound). */
  from: Date | null;
  /** Battery and activity: always for own devices, for shares when they include them. */
  includeDetails: boolean;
}

/** Whether the viewer may see other people at all: sessions may, tokens with `people:read`. */
export const mayReadPeople = (viewer: Viewer): boolean =>
  viewer.kind !== "token" || viewer.scopes?.includes("people:read") === true;

/**
 * The shares (alias `s`) that let `viewerId` see their owner at `now`: bound
 * to the viewer, not stopped, not ended, not hidden by the viewer. Every read
 * of another person's data starts from this condition.
 */
export const grantsViewer = (viewerId: string, now: Date): SQL => sql`
  s.recipient_user_id = ${viewerId}
  AND s.revoked_at IS NULL
  AND s.hidden_at IS NULL
  AND (s.expires_at IS NULL OR s.expires_at > ${now.toISOString()}::timestamptz)
`;

interface AccessRow extends Record<string, unknown> {
  device_id: string;
  owner_id: string;
  share_id: string | null;
  precision: string;
  history_days: number | null;
  include_details: boolean;
}

const precisionOf = (value: string): SharePrecision => {
  const precision = sharePrecisions.find((candidate) => candidate === value);
  if (precision === undefined) throw new Error(`Unknown share precision ${value}`);
  return precision;
};

/**
 * Every device the viewer may see — or, with `requested`, those (each must be
 * accessible, else 404 like an unknown id): the viewer's own devices (precise,
 * unbounded; for a token only with `locations:read`, and only those it is
 * limited to) and the devices of the shares that grant the viewer access
 * (`grantsViewer`; for a token only with `people:read`), each with its share's
 * precision, window and details. Own devices first, then by owner and age.
 *
 * The one place that decides what a viewer may see of other people: the
 * people routes, the live events, and anything later that reads shared data
 * (the MCP server, the map) go through it and `toSharedDevice`.
 */
export async function resolveAccessibleDevices(
  ctx: { db: Executor; config: { staleAfterHours: number } },
  viewer: Viewer,
  requested?: readonly string[],
  options: { now?: Date; ownDevices?: boolean } = {},
): Promise<AccessibleDevice[]> {
  const now = options.now ?? new Date();
  const viewerId = viewer.user.id;
  const allowed = allowedDeviceIds(viewer);
  const ownQuery =
    options.ownDevices === false || allowed?.length === 0 || !mayReadOwnLocations(viewer)
      ? null
      : sql`
          SELECT d.id AS device_id, d.user_id AS owner_id, NULL::uuid AS share_id,
            'precise' AS precision, NULL::int AS history_days, true AS include_details,
            0 AS rank, d.created_at
          FROM devices d
          WHERE d.user_id = ${viewerId}
            ${allowed === null ? sql`` : sql`AND d.id = ANY(${sql.param([...allowed])}::uuid[])`}
        `;
  const sharedQuery = mayReadPeople(viewer)
    ? sql`
        SELECT d.id AS device_id, d.user_id AS owner_id, s.id AS share_id,
          s.precision AS precision, s.history_days AS history_days,
          s.include_details AS include_details, 1 AS rank, d.created_at
        FROM shares s
        JOIN devices d ON d.user_id = s.owner_user_id
          AND (s.device_ids IS NULL OR d.id = ANY(s.device_ids))
        WHERE ${grantsViewer(viewerId, now)}
      `
    : null;
  const parts = [ownQuery, sharedQuery].filter((part) => part !== null);
  if (parts.length === 0) {
    if (requested !== undefined && requested.length > 0) throw notFound("No such device.");
    return [];
  }
  const result = await ctx.db.execute<AccessRow>(sql`
    ${sql.join(parts, sql` UNION ALL `)}
    ORDER BY rank, owner_id, created_at, device_id
  `);
  const live = liveWindowMs(ctx.config);
  const devices = result.rows.map(
    (row): AccessibleDevice => ({
      deviceId: row.device_id,
      ownerId: row.owner_id,
      shareId: row.share_id,
      precision: precisionOf(row.precision),
      historyDays: row.history_days,
      from: row.share_id === null ? null : windowStart(row.history_days, now, live),
      includeDetails: row.include_details,
    }),
  );
  if (requested === undefined) return devices;
  const wanted = new Set(requested);
  const found = devices.filter((device) => wanted.has(device.deviceId));
  if (found.length !== wanted.size) throw notFound("No such device.");
  return found;
}
