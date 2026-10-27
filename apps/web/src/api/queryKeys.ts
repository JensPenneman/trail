/* Type aliases rather than interfaces: they must be assignable to the query-string record of `apiFetch`. */

/** `[from, to)` instants plus an optional device filter (null = all of the user's devices). */
export type RangeParams = {
  from: string;
  to: string;
  deviceIds: readonly string[] | null;
};

/** Calendar dates `YYYY-MM-DD` (inclusive) in the user's time zone. */
export type DaysParams = {
  from: string;
  to: string;
  deviceIds: readonly string[] | null;
};

export type HeatmapParams = {
  /** `west,south,east,north`, rounded so tiny pans reuse the cache. */
  bbox: string;
  zoom: number;
  deviceIds: readonly string[] | null;
};

/** A range at a level of calculation (`/api/v1/tracks`). */
export type LevelTracksParams = RangeParams & {
  level: "raw" | "averaged" | "mapped" | "inferred";
};

/**
 * Someone's track (`/api/v1/people/{userId}/track`). `share` names the share's
 * id and history, so a share that changes is another query: what it allowed
 * before is never asked for again.
 */
export type PersonTrackParams = {
  from: string;
  to: string;
  deviceIds: readonly string[];
  share: string;
};

/**
 * A period of Insights (`/api/v1/insights/*`): local dates, either end left
 * out for the server's default (the first day with data, today), the devices
 * (null = all) and a mode for the pages that filter by one.
 */
export type InsightsParams = {
  from: string | null;
  to: string | null;
  deviceIds: readonly string[] | null;
  mode: string | null;
};

export type ActivityParams = {
  hours: number;
  deviceIds: readonly string[] | null;
};

/**
 * Every TanStack Query key in one place. The first element names the resource,
 * so a prefix such as `queryKeys.all.tracks` invalidates every cached range.
 */
export const queryKeys = {
  all: {
    tracks: ["tracks"],
    days: ["days"],
    activity: ["activity"],
    visits: ["visits"],
    trips: ["trips"],
    heatmap: ["heatmap"],
    ingestLog: ["ingest-log"],
    locations: ["locations"],
    levelTracks: ["level-tracks"],
    timeline: ["timeline"],
    deviceMode: ["device-mode"],
    personTracks: ["person-tracks"],
    insights: ["insights"],
  },
  config: ["config"],
  session: ["session"],
  devices: ["devices"],
  device: (deviceId: string) => ["device", deviceId] as const,
  ingestLog: (deviceId: string, limit: number) => ["ingest-log", deviceId, limit] as const,
  locations: (deviceId: string) => ["locations", deviceId] as const,
  tracks: (params: RangeParams) => ["tracks", params] as const,
  visits: (params: RangeParams) => ["visits", params] as const,
  trips: (params: RangeParams) => ["trips", params] as const,
  days: (params: DaysParams) => ["days", params] as const,
  activity: (params: ActivityParams) => ["activity", params] as const,
  heatmap: (params: HeatmapParams) => ["heatmap", params] as const,
  levelTracks: (params: LevelTracksParams) => ["level-tracks", params] as const,
  timeline: (params: RangeParams) => ["timeline", params] as const,
  deviceMode: (deviceId: string) => ["device-mode", deviceId] as const,
  insightsOverview: (params: InsightsParams) => ["insights", "overview", params] as const,
  insightsMode: (mode: string, params: InsightsParams) =>
    ["insights", "mode", mode, params] as const,
  insightsTime: (params: InsightsParams) => ["insights", "time", params] as const,
  insightsRoads: (params: InsightsParams) => ["insights", "roads", params] as const,
  personTracksOf: (userId: string) => ["person-tracks", userId] as const,
  personTracks: (userId: string, params: PersonTrackParams) =>
    ["person-tracks", userId, params] as const,
  passkeys: ["passkeys"],
  sessions: ["sessions"],
  apiTokens: ["api-tokens"],
  invites: ["invites"],
  adminUsers: ["admin-users"],
  linkInfo: (token: string) => ["link-info", token] as const,
  /** People who share with the signed-in person (v1), kept current by `person` events. */
  people: ["people"],
  /** The signed-in person's own shares, and the ones others give them. */
  shares: ["shares"],
  incomingShares: ["incoming-shares"],
  shareLinks: ["share-links"],
  /** What a public link shows; the secret is the key's second element. */
  publicShare: (secret: string) => ["public-share", secret] as const,
  /** Mutations that end the session on purpose: signing out, deleting the account. */
  endSession: ["end-session"],
  /** Creating an API token: its dialog stays open until the one-time secret is shown. */
  createApiToken: ["create-api-token"],
  deleteDevice: (deviceId: string) => ["delete-device", deviceId] as const,
} as const;
