import type {
  ChosenMode,
  DeviceMode,
  ModeOverride,
  ModeOverrideSource,
  TransportMode,
} from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import type { Database, Executor } from "../db/database";
import { toIso, toIsoOrNull } from "../db/toIso";
import type { DeviceAccess } from "../devices/deviceAccess";
import { findOwnedDevice } from "../devices/findOwnedDevice";
import { HttpError } from "../http/httpError";
import { lockDeviceProcessing } from "../processing/deviceLock";
import { enqueueWindow } from "../processing/processingQueue";
import { endsToggleSql } from "../processing/travelFamily";
import { type SegmentRow, segmentColumns } from "./segmentRow";

interface ToggleRow extends Record<string, unknown> {
  id: string;
  device_id: string;
  mode: ChosenMode;
  from_at: string;
  to_at: string | null;
  source: ModeOverrideSource;
  created_at: string;
}

const toOverride = (row: ToggleRow): ModeOverride => ({
  id: row.id,
  deviceId: row.device_id,
  kind: "toggle",
  mode: row.mode,
  from: toIso(row.from_at),
  until: toIsoOrNull(row.to_at),
  source: row.source,
  createdAt: toIso(row.created_at),
});

/**
 * The quick toggle in force at `now`: not revoked, not past its until, and
 * nothing that ends it detected since it began — a stop of
 * `toggleEndingStopS` or more, or a move of another kind of travel
 * (`endsToggleSql`).
 */
async function openToggle(
  db: Executor,
  deviceId: string,
  now: Date,
  lock = false,
): Promise<ToggleRow | null> {
  const result = await db.execute<ToggleRow>(sql`
    SELECT o.id, o.device_id, o.mode, o.from_at::text, o.to_at::text, o.source, o.created_at::text
    FROM mode_overrides o
    WHERE o.device_id = ${deviceId} AND o.kind = 'toggle' AND o.revoked_at IS NULL
      AND o.from_at <= ${now.toISOString()}::timestamptz
      AND (o.to_at IS NULL OR o.to_at > ${now.toISOString()}::timestamptz)
      AND NOT EXISTS (
        SELECT 1 FROM segments s
        WHERE s.device_id = o.device_id AND s.started_at > o.from_at AND ${endsToggleSql("s", "o")}
      )
    ORDER BY o.created_at DESC
    LIMIT 1
    ${lock ? sql`FOR UPDATE` : sql``}
  `);
  return result.rows[0] ?? null;
}

/**
 * What a device is doing now (docs/architecture.md §17.5): the quick toggle in
 * force, if any, and the current mode — the toggle's, or that of the latest
 * segment while it is recent (a stop counts as stationary).
 */
export async function loadDeviceMode(
  db: Executor,
  access: DeviceAccess,
  deviceId: string,
  options: { now: Date; recentMs: number },
): Promise<DeviceMode> {
  const device = await findOwnedDevice(db, access, deviceId);
  const toggle = await openToggle(db, device.id, options.now);
  const latest = await db.execute<SegmentRow>(sql`
    SELECT ${segmentColumns} FROM segments s
    WHERE s.device_id = ${device.id}
    ORDER BY s.started_at DESC
    LIMIT 1
  `);
  const segment = latest.rows[0];
  const endedAt = segment === undefined ? 0 : Date.parse(toIso(segment.ended_at));
  const recent = segment !== undefined && endedAt >= options.now.getTime() - options.recentMs;
  if (toggle !== null) {
    const covers =
      segment !== undefined &&
      segment.kind === "move" &&
      endedAt >= Date.parse(toIso(toggle.from_at));
    return {
      override: toOverride(toggle),
      current: {
        mode: toggle.mode,
        setByUser: true,
        since: toIso(toggle.from_at),
        segmentId: covers ? segment.id : null,
      },
    };
  }
  if (segment === undefined || !recent) return { override: null, current: null };
  const mode: TransportMode =
    segment.kind === "stop"
      ? "stationary"
      : (segment.mode_user ?? segment.mode_inferred ?? "unknown");
  return {
    override: null,
    current: {
      mode,
      setByUser: segment.kind === "move" && segment.mode_user !== null,
      since: toIso(segment.started_at),
      segmentId: segment.id,
    },
  };
}

/**
 * The quick toggle (docs/architecture.md §17.5): from now on the device
 * travels by `mode`, until `until`, the first detected stop of
 * `toggleEndingStopS` or more, or the first move the inference reads as
 * another kind of travel, whichever comes first. Idempotent — the same mode
 * again changes nothing (but a new until);
 * another mode ends the running toggle and starts a new one; `null` ends it.
 * Spans that lose a toggle are queued for the inference again (`queue`).
 */
export async function setDeviceMode(
  db: Database,
  access: DeviceAccess,
  deviceId: string,
  request: { mode: ChosenMode | null; until?: Date | undefined },
  options: { source: ModeOverrideSource; now: Date; queue: boolean },
): Promise<{ changed: { from: Date; to: Date } | null }> {
  const device = await findOwnedDevice(db, access, deviceId);
  const { now } = options;
  const until = request.until;
  if (until !== undefined && until <= now) {
    throw new HttpError(
      400,
      "validation_failed",
      "Invalid request — until: must be in the future",
      {
        until: ["Must be in the future"],
      },
    );
  }
  return db.transaction(async (tx) => {
    await lockDeviceProcessing(tx, device.id);
    const open = await openToggle(tx, device.id, now, true);
    if (open !== null && open.mode === request.mode) {
      if (until !== undefined && toIsoOrNull(open.to_at) !== until.toISOString()) {
        await tx.execute(sql`
          UPDATE mode_overrides SET to_at = ${until.toISOString()}::timestamptz WHERE id = ${open.id}
        `);
      }
      return { changed: null };
    }
    let changed: { from: Date; to: Date } | null = null;
    if (open !== null) {
      const from = new Date(toIso(open.from_at));
      // A toggle that has not begun yet is withdrawn; one that has ends now.
      if (from >= now) {
        await tx.execute(sql`UPDATE mode_overrides SET revoked_at = now() WHERE id = ${open.id}`);
      } else {
        await tx.execute(sql`
          UPDATE mode_overrides SET to_at = ${now.toISOString()}::timestamptz WHERE id = ${open.id}
        `);
      }
      changed = { from, to: now };
      if (options.queue) {
        await enqueueWindow(tx, {
          deviceId: device.id,
          from,
          to: new Date(now.getTime() + 60_000),
          reason: "override",
          fromLevel: "inferred",
        });
      }
    }
    if (request.mode !== null) {
      await tx.execute(sql`
        INSERT INTO mode_overrides (device_id, kind, from_at, to_at, mode, source, created_by)
        VALUES (${device.id}, 'toggle', ${now.toISOString()}::timestamptz,
          ${until === undefined ? null : until.toISOString()}::timestamptz, ${request.mode},
          ${options.source}, ${access.user.id})
      `);
    }
    return { changed };
  });
}
