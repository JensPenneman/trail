import type { PublicConfig } from "@trail/contracts/config";
import type { DeviceSummary } from "@trail/contracts/device";
import type { TracksResponse } from "@trail/contracts/track";
import type { SessionUser } from "@trail/contracts/user";

/** Contract-shaped test data: a Brussels user with a phone and a car tracker. */
export const ids = {
  user: "01926f3a-8b2c-7d4e-9f10-2a3b4c5d6e7f",
  phone: "01926f3a-9c3d-7e5f-a021-3b4c5d6e7f80",
  car: "01926f3b-1d4e-7f60-b132-4c5d6e7f8091",
  ceremony: "01926f3d-3f60-7b82-9354-6e7f8091a2b3",
} as const;

export const config: PublicConfig = {
  appName: "Trail",
  version: "0.1.0",
  commit: "3f9c2a1",
  builtAt: "2026-09-30T18:04:12.000Z",
  publicUrl: "https://trail.example.com",
  ingestUrl: "https://trail.example.com/api/overland",
  mapStyles: { light: "https://tiles.example.com/light", dark: "https://tiles.example.com/dark" },
  thresholds: { liveMinutes: 15, staleHours: 12 },
  features: { alerts: true },
};

export const user: SessionUser = {
  id: ids.user,
  email: "jens@example.com",
  displayName: "Jens",
  isAdmin: true,
  timezone: "Europe/Brussels",
  createdAt: "2026-03-02T19:20:11.000Z",
};

export function device(overrides: Partial<DeviceSummary> = {}): DeviceSummary {
  return {
    id: ids.phone,
    name: "iPhone 16",
    source: "overland",
    deviceKey: "iphone-16-k3f9",
    tokenHint: "q7Zx",
    alertsEnabled: true,
    createdAt: "2026-03-02T19:31:40.000Z",
    lastSeenAt: new Date(Date.now() - 60_000).toISOString(),
    lastLocation: {
      lat: 50.98452,
      lon: 3.52683,
      recordedAt: new Date(Date.now() - 90_000).toISOString(),
      accuracy: 12,
      speed: 0,
      altitude: 11,
      course: null,
      motion: ["stationary"],
    },
    battery: { level: 0.62, state: "unplugged", recordedAt: new Date().toISOString() },
    liveTrip: null,
    counts: { today: 1066, last24h: 1240, total: 184_322 },
    pendingSettings: null,
    settingsAppliedAt: null,
    ...overrides,
  };
}

export const car = (): DeviceSummary =>
  device({
    id: ids.car,
    name: "Car",
    deviceKey: "car-old-iphone",
    createdAt: "2026-05-18T10:12:03.000Z",
    lastSeenAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
    battery: { level: 1, state: "full", recordedAt: new Date().toISOString() },
    counts: { today: 230, last24h: 230, total: 41_207 },
  });

export function tracks(from: string, to: string): TracksResponse {
  const start = Date.parse(from) / 1000 + 7 * 3600;
  return {
    from,
    to,
    tracks: [
      {
        deviceId: ids.phone,
        total: 3,
        returned: 3,
        simplified: false,
        distanceM: 1250,
        firstAt: new Date(start * 1000).toISOString(),
        lastAt: new Date((start + 120) * 1000).toISOString(),
        points: [
          [3.52683, 50.98452, start, 0, 10, 11],
          [3.53321, 50.98612, start + 60, 12.5, 8, 11],
          [3.54502, 50.99058, start + 120, 13.1, 7, 12],
        ],
      },
    ],
  };
}
