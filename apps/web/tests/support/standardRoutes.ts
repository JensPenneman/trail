import { car, config, device, ids, tracks, user } from "./fixtures";

/** Answers for every read the signed-in screens make. */
export function standardRoutes() {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    "GET /api/config": { status: 200, body: config },
    "GET /api/auth/session": { status: 200, body: { user } },
    "GET /api/devices": { status: 200, body: { devices: [device(), car()] } },
    [`GET /api/devices/${ids.phone}`]: { status: 200, body: { device: device() } },
    [`GET /api/devices/${ids.phone}/ingest-log`]: {
      status: 200,
      body: {
        entries: [
          {
            id: "900",
            receivedAt: iso(now - 60_000),
            records: 42,
            locations: 40,
            duplicates: 2,
            visits: 0,
            trips: 0,
            events: 0,
            rejected: 1,
            durationMs: 21,
            userAgent: "Overland/2025.3",
          },
        ],
      },
    },
    [`GET /api/devices/${ids.car}/ingest-log`]: { status: 200, body: { entries: [] } },
    "GET /api/tracks": ({ url }: { url: URL }) => ({
      status: 200,
      body: tracks(
        url.searchParams.get("from") ?? iso(now - 86_400_000),
        url.searchParams.get("to") ?? iso(now),
      ),
    }),
    "GET /api/stats/activity": {
      status: 200,
      body: {
        from: iso(now - 48 * 3_600_000),
        to: iso(now),
        buckets: [
          {
            start: iso(Math.floor(now / 3_600_000) * 3_600_000),
            deviceId: ids.phone,
            recorded: 40,
            uploads: 3,
          },
        ],
      },
    },
    "GET /api/stats/days": ({ url }: { url: URL }) => ({
      status: 200,
      body: {
        timezone: "Europe/Brussels",
        days: [
          {
            date: url.searchParams.get("to") ?? "2026-09-30",
            deviceId: ids.phone,
            points: 1066,
            distanceM: 32_900,
            firstAt: iso(now - 10 * 3_600_000),
            lastAt: iso(now),
          },
        ],
      },
    }),
    "GET /api/visits": {
      status: 200,
      body: {
        visits: [
          {
            deviceId: ids.phone,
            recordedAt: iso(now - 3_600_000),
            arrivedAt: iso(now - 4 * 3_600_000),
            departedAt: iso(now - 3_600_000),
            lat: 51.048,
            lon: 3.718,
            accuracy: 24,
          },
        ],
      },
    },
    "GET /api/trips": {
      status: 200,
      body: {
        trips: [
          {
            deviceId: ids.phone,
            startedAt: iso(now - 5 * 3_600_000),
            endedAt: iso(now - 4.5 * 3_600_000),
            mode: "bicycle",
            distanceM: 8_400,
            durationS: 1800,
            steps: null,
            stoppedAutomatically: false,
          },
        ],
      },
    },
    "GET /api/heatmap": {
      status: 200,
      body: {
        cellZoom: 15,
        cells: [
          [3.527, 50.985, 9000],
          [3.718, 51.048, 6400],
        ],
        truncated: false,
      },
    },
    "GET /api/locations": {
      status: 200,
      body: {
        items: [
          {
            recordedAt: iso(now - 90_000),
            receivedAt: iso(now - 60_000),
            lat: 50.98452,
            lon: 3.52683,
            altitude: 11,
            speed: 0,
            course: null,
            accuracy: 12,
            verticalAccuracy: 4,
            speedAccuracy: null,
            courseAccuracy: null,
            motion: ["stationary"],
            batteryLevel: 0.62,
            batteryState: "unplugged",
            wifi: null,
            extra: null,
          },
        ],
        nextCursor: null,
      },
    },
    "GET /api/me/passkeys": {
      status: 200,
      body: {
        passkeys: [
          {
            id: "pk-1",
            name: "iCloud Keychain",
            rpId: "localhost",
            usableHere: true,
            provider: "iCloud Keychain",
            backedUp: true,
            deviceType: "multiDevice",
            transports: ["internal"],
            createdAt: "2026-03-02T19:20:11.000Z",
            lastUsedAt: null,
          },
        ],
      },
    },
    "GET /api/me/sessions": {
      status: 200,
      body: {
        sessions: [
          {
            id: "s1",
            current: true,
            label: "Firefox on Mac",
            ip: "127.0.0.1",
            createdAt: iso(now - 86_400_000),
            lastSeenAt: iso(now),
            expiresAt: iso(now + 29 * 86_400_000),
          },
          {
            id: "s2",
            current: false,
            label: "Safari on iPhone",
            ip: null,
            createdAt: iso(now - 9 * 86_400_000),
            lastSeenAt: iso(now - 3_600_000),
            expiresAt: iso(now + 21 * 86_400_000),
          },
        ],
      },
    },
    "GET /api/admin/invites": { status: 200, body: { invites: [] } },
    "GET /api/admin/users": {
      status: 200,
      body: {
        users: [
          {
            id: ids.user,
            email: user.email,
            displayName: user.displayName,
            isAdmin: true,
            createdAt: user.createdAt,
            devices: 2,
            passkeys: 1,
            lastSeenAt: iso(now),
          },
        ],
      },
    },
  };
}
