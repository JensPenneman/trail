import { type ChosenMode, type TransportMode, toggleEndingStopS } from "@trail/contracts/transport";
import { sql } from "drizzle-orm";
import type { Config } from "../config/config";
import type { Executor } from "../db/database";

interface CurrentModeRow extends Record<string, unknown> {
  device_id: string;
  toggle_mode: ChosenMode | null;
  kind: "stop" | "move" | null;
  recent: boolean | null;
  mode_user: ChosenMode | null;
  mode_inferred: TransportMode | null;
}

/** How recent the latest stop or move must be to count as now: the live window, as for the owner. */
export const currentModeRecentMs = (config: Config): number => config.liveWindowMinutes * 60_000;

/**
 * What devices are doing now, for the activity that shares and links with
 * details show (docs/architecture.md §8.5): the current mode as location
 * processing has it for the owner (`loadDeviceMode`, §17.5) — the quick
 * toggle in force, else the mode of the latest stop or move while it ended
 * recently, a stop being `stationary` — for all of the devices in one query.
 * Devices without a current mode are left out.
 */
export async function loadCurrentModes(
  db: Executor,
  deviceIds: readonly string[],
  options: { now: Date; recentMs: number },
): Promise<Map<string, TransportMode>> {
  const modes = new Map<string, TransportMode>();
  if (deviceIds.length === 0) return modes;
  const now = options.now.toISOString();
  const since = new Date(options.now.getTime() - options.recentMs).toISOString();
  const { rows } = await db.execute<CurrentModeRow>(sql`
    SELECT d.id AS device_id, t.mode AS toggle_mode, s.kind,
      s.ended_at >= ${since}::timestamptz AS recent, s.mode_user, s.mode_inferred
    FROM unnest(${sql.param([...new Set(deviceIds)])}::uuid[]) AS d(id)
    LEFT JOIN LATERAL (
      SELECT o.mode FROM mode_overrides o
      WHERE o.device_id = d.id AND o.kind = 'toggle' AND o.revoked_at IS NULL
        AND o.from_at <= ${now}::timestamptz
        AND (o.to_at IS NULL OR o.to_at > ${now}::timestamptz)
        AND NOT EXISTS (
          SELECT 1 FROM segments x
          WHERE x.device_id = o.device_id AND x.kind = 'stop' AND x.started_at > o.from_at
            AND x.ended_at - x.started_at >= make_interval(secs => ${toggleEndingStopS})
        )
      ORDER BY o.created_at DESC
      LIMIT 1
    ) t ON true
    LEFT JOIN LATERAL (
      SELECT s.kind, s.ended_at, s.mode_user, s.mode_inferred FROM segments s
      WHERE s.device_id = d.id
      ORDER BY s.started_at DESC
      LIMIT 1
    ) s ON true
  `);
  for (const row of rows) {
    const latest =
      row.recent !== true
        ? null
        : row.kind === "stop"
          ? "stationary"
          : (row.mode_user ?? row.mode_inferred ?? "unknown");
    const mode = row.toggle_mode ?? latest;
    if (mode !== null) modes.set(row.device_id, mode);
  }
  return modes;
}
