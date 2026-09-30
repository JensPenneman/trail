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
  passkeys: ["passkeys"],
  sessions: ["sessions"],
  invites: ["invites"],
  adminUsers: ["admin-users"],
  linkInfo: (token: string) => ["link-info", token] as const,
} as const;
