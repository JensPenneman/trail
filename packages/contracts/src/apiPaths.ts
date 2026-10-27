/** Every API route (dashboard and public v1), so the server and its clients cannot drift apart. */
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
    /** API tokens: managed with the session only, never with a token. */
    tokens: "/api/me/tokens",
    token: (tokenId: string) => `/api/me/tokens/${id(tokenId)}`,
    rollToken: (tokenId: string) => `/api/me/tokens/${id(tokenId)}/roll`,
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
  /** The public API (docs/api.md); `openApi` is its OpenAPI document. */
  v1: {
    root: "/api/v1",
    openApi: "/api/v1/openapi.json",
    me: "/api/v1/me",
    devices: {
      root: "/api/v1/devices",
      one: (deviceId: string) => `/api/v1/devices/${id(deviceId)}`,
      location: (deviceId: string) => `/api/v1/devices/${id(deviceId)}/location`,
      mode: (deviceId: string) => `/api/v1/devices/${id(deviceId)}/mode`,
    },
    tokens: { verify: "/api/v1/tokens/verify" },
    locations: "/api/v1/locations",
    visits: "/api/v1/visits",
    trips: "/api/v1/trips",
    stats: { days: "/api/v1/stats/days", activity: "/api/v1/stats/activity" },
    heatmap: "/api/v1/heatmap",
    tracks: "/api/v1/tracks",
    segments: {
      root: "/api/v1/segments",
      mode: (segmentId: string) => `/api/v1/segments/${id(segmentId)}/mode`,
    },
    statsModes: "/api/v1/stats/modes",
    insights: {
      overview: "/api/v1/insights/overview",
      mode: (mode: string) => `/api/v1/insights/modes/${id(mode)}`,
      time: "/api/v1/insights/time",
      roads: "/api/v1/insights/roads",
    },
    people: {
      root: "/api/v1/people",
      one: (userId: string) => `/api/v1/people/${id(userId)}`,
      track: (userId: string) => `/api/v1/people/${id(userId)}/track`,
    },
    shares: {
      root: "/api/v1/shares",
      one: (shareId: string) => `/api/v1/shares/${id(shareId)}`,
      confirm: (shareId: string) => `/api/v1/shares/${id(shareId)}/confirm`,
      incoming: "/api/v1/shares/incoming",
      hide: (shareId: string) => `/api/v1/shares/incoming/${id(shareId)}/hide`,
      unhide: (shareId: string) => `/api/v1/shares/incoming/${id(shareId)}/unhide`,
    },
    shareLinks: {
      root: "/api/v1/share-links",
      one: (linkId: string) => `/api/v1/share-links/${id(linkId)}`,
    },
    /** The data access log of the caller's account (`audit:read`). */
    accessLog: {
      root: "/api/v1/access-log",
      summary: "/api/v1/access-log/summary",
    },
  },
  /** What a public link shows, without an account; its secret travels in the `X-Share-Secret` header. */
  publicShare: "/api/public/share",
  /**
   * The page of public links in the SPA. The secret is the fragment
   * (`/s#trls_…`), which browsers never send to a server, a proxy or as a referrer.
   */
  sharePage: {
    root: "/s",
    link: (secret: string) => `/s#${id(secret)}`,
  },
  /** The API reference (Scalar) — a page the API serves itself, outside the SPA. */
  docs: "/docs",
  /** The MCP server (Streamable HTTP, API tokens only): docs/mcp.md. */
  mcp: "/mcp",
} as const;
