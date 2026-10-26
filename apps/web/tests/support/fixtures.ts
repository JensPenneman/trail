import type { ApiToken } from "@trail/contracts/apiToken";
import type { PublicConfig } from "@trail/contracts/config";
import type { DeviceSummary } from "@trail/contracts/device";
import type { TracksResponse } from "@trail/contracts/track";
import type {
  DeviceMode,
  LevelTracksResponse,
  ProcessingLevel,
  Segment,
} from "@trail/contracts/transport";
import type { SessionUser } from "@trail/contracts/user";

/** Contract-shaped test data: a Brussels user with a phone and a car tracker. */
export const ids = {
  user: "01926f3a-8b2c-7d4e-9f10-2a3b4c5d6e7f",
  phone: "01926f3a-9c3d-7e5f-a021-3b4c5d6e7f80",
  car: "01926f3b-1d4e-7f60-b132-4c5d6e7f8091",
  ceremony: "01926f3d-3f60-7b82-9354-6e7f8091a2b3",
  token: "01926f3e-4a71-7c93-a465-7f8091a2b3c4",
  oldToken: "01926f3e-5b82-7da4-b576-8091a2b3c4d5",
  stop: "019a1f7e-3c55-7b42-9d0e-5b7f3a1c2d40",
  train: "019a1f7e-3c55-7b42-9d0e-5b7f3a1c2d41",
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

/** An API token as `GET /api/me/tokens` lists it: Home Assistant, reading the phone. */
export function apiToken(overrides: Partial<ApiToken> = {}): ApiToken {
  return {
    id: ids.token,
    name: "Home Assistant",
    hint: "x7Kq",
    scopes: ["devices:read", "locations:read"],
    deviceIds: [ids.phone],
    allowedIps: null,
    expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
    createdAt: "2026-10-01T09:00:00.000Z",
    lastUsedAt: new Date(Date.now() - 120_000).toISOString(),
    lastUsedIp: "192.168.1.20",
    revokedAt: null,
    status: "active",
    ...overrides,
  };
}

/** The phone's day as stops and moves: a stop at home, then a train ride the inference is unsure of. */
export function timeline(from: string): Segment[] {
  const start = Date.parse(from) + 7 * 3_600_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  return [
    {
      id: ids.stop,
      deviceId: ids.phone,
      kind: "stop",
      startedAt: iso(start - 3_600_000),
      endedAt: iso(start),
      durationS: 3600,
      distanceM: 0,
      mode: null,
      modeInferred: null,
      modeUser: null,
      confidence: null,
      needsReview: false,
      averageSpeed: null,
      maxSpeed: null,
      pointCount: 40,
      start: { lat: 50.98452, lon: 3.52683 },
      end: { lat: 50.98452, lon: 3.52683 },
      centroid: { lat: 50.98452, lon: 3.52683 },
    },
    {
      id: ids.train,
      deviceId: ids.phone,
      kind: "move",
      startedAt: iso(start),
      endedAt: iso(start + 2_280_000),
      durationS: 2280,
      distanceM: 31_240,
      mode: "train",
      modeInferred: "train",
      modeUser: null,
      confidence: 0.55,
      needsReview: true,
      averageSpeed: 13.7,
      maxSpeed: 38.1,
      pointCount: 12,
      start: { lat: 50.98452, lon: 3.52683 },
      end: { lat: 51.0362, lon: 3.7104 },
      centroid: { lat: 51.01, lon: 3.62 },
    },
  ];
}

/** `/api/v1/tracks` at a level: the timeline's segments, or a piece of track. */
export function levelTracks(from: string, to: string, level: ProcessingLevel): LevelTracksResponse {
  const start = Date.parse(from) / 1000 + 7 * 3600;
  const points: [number, number, number][] = [
    [3.52683, 50.98452, start],
    [3.6, 51.0, start + 1200],
    [3.7104, 51.0362, start + 2280],
  ];
  const segments =
    level === "inferred"
      ? timeline(from).map((segment) => ({
          id: segment.id,
          deviceId: segment.deviceId,
          kind: segment.kind,
          level: "inferred" as const,
          mode: segment.mode,
          modeInferred: segment.modeInferred,
          modeUser: segment.modeUser,
          confidence: segment.confidence,
          needsReview: segment.needsReview,
          startedAt: segment.startedAt,
          endedAt: segment.endedAt,
          distanceM: segment.distanceM,
          points: segment.kind === "stop" ? [points[0] ?? [0, 0, 0]] : points,
        }))
      : [
          {
            id: null,
            deviceId: ids.phone,
            kind: "track" as const,
            level,
            mode: null,
            modeInferred: null,
            modeUser: null,
            confidence: null,
            needsReview: false,
            startedAt: new Date(start * 1000).toISOString(),
            endedAt: new Date((start + 2280) * 1000).toISOString(),
            distanceM: 31_240,
            points,
          },
        ];
  return { level, availableLevel: level, from, to, simplified: false, segments };
}

export const automatic: DeviceMode = { override: null, current: null };
