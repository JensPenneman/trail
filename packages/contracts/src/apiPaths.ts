/** Every dashboard API route, so the server and the client cannot drift apart. */
const id = (value: string): string => encodeURIComponent(value);

export const apiPaths = {
  config: "/api/config",
  health: "/api/health",
  healthLive: "/api/health/live",
  /** Overland receiver endpoint (Bearer device token). */
  overland: "/api/overland",
  events: "/api/events",
  auth: {
    session: "/api/auth/session",
    start: "/api/auth/start",
    passkey: "/api/auth/passkey",
    finish: "/api/auth/finish",
    logout: "/api/auth/logout",
    link: (token: string) => `/api/auth/link/${id(token)}`,
    linkStart: (token: string) => `/api/auth/link/${id(token)}/start`,
  },
  me: {
    root: "/api/me",
    passkeys: "/api/me/passkeys",
    passkeyOptions: "/api/me/passkeys/options",
    passkey: (passkeyId: string) => `/api/me/passkeys/${id(passkeyId)}`,
    sessions: "/api/me/sessions",
    session: (sessionId: string) => `/api/me/sessions/${id(sessionId)}`,
    revokeOtherSessions: "/api/me/sessions/revoke-others",
    passkeyLinks: "/api/me/passkey-links",
  },
  admin: {
    invites: "/api/admin/invites",
    invite: (inviteId: string) => `/api/admin/invites/${id(inviteId)}`,
    users: "/api/admin/users",
  },
  devices: {
    root: "/api/devices",
    one: (deviceId: string) => `/api/devices/${id(deviceId)}`,
    token: (deviceId: string) => `/api/devices/${id(deviceId)}/token`,
    ingestLog: (deviceId: string) => `/api/devices/${id(deviceId)}/ingest-log`,
  },
  tracks: "/api/tracks",
  heatmap: "/api/heatmap",
  statsDays: "/api/stats/days",
  statsActivity: "/api/stats/activity",
  visits: "/api/visits",
  trips: "/api/trips",
  locations: "/api/locations",
  deleteLocations: "/api/locations/delete",
  export: "/api/export",
} as const;
