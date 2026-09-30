import { batteryStates, type DeviceSummary } from "@trail/contracts/device";
import { remoteSettingsPresets } from "@trail/contracts/remoteSettings";
import { toIso, toIsoOrNull } from "../db/toIso";

/** Raw row of the device summary query (snake_case, timestamps as Postgres text). */
export interface DeviceSummaryRow extends Record<string, unknown> {
  id: string;
  name: string;
  device_key: string;
  token_hint: string;
  alerts_enabled: boolean;
  created_at: string;
  last_seen_at: string | null;
  last_recorded_at: string | null;
  last_lat: number | null;
  last_lon: number | null;
  last_accuracy: number | null;
  last_speed: number | null;
  last_altitude: number | null;
  last_course: number | null;
  last_motion: string[] | null;
  battery_level: number | null;
  battery_state: string | null;
  battery_recorded_at: string | null;
  live_trip: unknown;
  points_total: string | number;
  pending_settings: string | null;
  settings_applied_at: string | null;
  today: number;
  last24h: number;
}

const batteryStateOf = (value: string | null) =>
  batteryStates.find((state) => state === value) ?? null;

const presetOf = (value: string | null) =>
  remoteSettingsPresets.find((preset) => preset === value) ?? null;

const liveTripOf = (value: unknown): DeviceSummary["liveTrip"] => {
  if (typeof value !== "object" || value === null) return null;
  if (!("mode" in value) || !("startedAt" in value) || !("distanceM" in value)) return null;
  const { mode, startedAt, distanceM } = value;
  if (typeof mode !== "string" || typeof startedAt !== "string" || typeof distanceM !== "number") {
    return null;
  }
  return { mode, startedAt, distanceM };
};

export function toDeviceSummary(row: DeviceSummaryRow): DeviceSummary {
  return {
    id: row.id,
    name: row.name,
    source: "overland",
    deviceKey: row.device_key,
    tokenHint: row.token_hint,
    alertsEnabled: row.alerts_enabled,
    createdAt: toIso(row.created_at),
    lastSeenAt: toIsoOrNull(row.last_seen_at),
    lastLocation:
      row.last_recorded_at !== null && row.last_lat !== null && row.last_lon !== null
        ? {
            lat: row.last_lat,
            lon: row.last_lon,
            recordedAt: toIso(row.last_recorded_at),
            accuracy: row.last_accuracy,
            speed: row.last_speed,
            altitude: row.last_altitude,
            course: row.last_course,
            motion: row.last_motion ?? [],
          }
        : null,
    battery:
      row.battery_recorded_at === null
        ? null
        : {
            level:
              row.battery_level !== null && row.battery_level >= 0 && row.battery_level <= 1
                ? row.battery_level
                : null,
            state: batteryStateOf(row.battery_state),
            recordedAt: toIso(row.battery_recorded_at),
          },
    liveTrip: liveTripOf(row.live_trip),
    counts: {
      today: row.today,
      last24h: row.last24h,
      total: Number(row.points_total),
    },
    pendingSettings: presetOf(row.pending_settings),
    settingsAppliedAt: toIsoOrNull(row.settings_applied_at),
  };
}
