import type { DataAccessActorKind, DataAccessChannel } from "@trail/contracts/dataAccess";

/*
 * What the actions of the data access log (docs/architecture.md §8.8) are
 * called on the pages: the server's names — a v1 operationId, a dashboard
 * route, an MCP tool — in words. A name the server learns later shows as it
 * is until it gets words of its own here.
 */

/** Names of the actions of one's own data, whoever did them. */
const actionLabels: Readonly<Record<string, string>> = {
  getMe: "Profile",
  listDevices: "Devices",
  getDevice: "A device",
  updateDevice: "Changed a device",
  getDeviceLocation: "A device's position",
  getDeviceMode: "A device's transport mode",
  setDeviceMode: "Set a device's transport mode",
  listLocations: "Raw points",
  listVisits: "Visits",
  listTrips: "Trips",
  listDayStats: "Day statistics",
  getActivity: "Recent activity",
  getHeatmap: "Heatmap",
  getTracks: "Tracks",
  listSegments: "Stops and moves",
  setSegmentMode: "Corrected the mode of a move",
  resetSegmentMode: "Took back a mode correction",
  getModeStats: "Transport statistics",
  getInsightsOverview: "Insights",
  getInsightsMode: "Insights of a transport mode",
  getInsightsTime: "When you travel",
  getInsightsRoads: "Roads you travel",
  listShares: "Your shares",
  createShare: "Started a share",
  updateShare: "Changed a share",
  deleteShare: "Stopped a share",
  confirmShare: "Confirmed a share",
  listIncomingShares: "Shares with you",
  hideIncomingShare: "Hid someone who shares",
  unhideIncomingShare: "Showed someone who shares again",
  listShareLinks: "Public links",
  createShareLink: "Made a public link",
  deleteShareLink: "Turned off a public link",
  listPeople: "The people who share with you",
  getPerson: "Someone who shares with you",
  getPersonTrack: "The history of someone who shares with you",
  "dashboard.tracks": "Tracks as recorded",
  "dashboard.heatmap": "Heatmap",
  "dashboard.statsDays": "Day statistics",
  "dashboard.statsActivity": "Recent activity",
  "dashboard.visits": "Visits",
  "dashboard.trips": "Trips",
  "dashboard.locations": "Raw points",
  "dashboard.export": "Exported your data",
  "dashboard.deleteLocations": "Deleted a period",
  "dashboard.deleteDevice": "Deleted a device",
  "dashboard.createApiToken": "Created an API token",
  "dashboard.updateApiToken": "Changed an API token",
  "dashboard.rollApiToken": "Rolled an API token",
  "dashboard.revokeApiToken": "Revoked an API token",
  "mcp.list_devices": "Devices",
  "mcp.get_current_location": "Current location",
  "mcp.get_location_at": "Location at a time",
  "mcp.get_timeline": "Timeline",
  "mcp.get_day_summary": "Summary of a day",
  "mcp.get_visits": "Visits",
  "mcp.get_trips": "Trips",
  "mcp.get_people": "The people who share with you",
  "mcp.set_transport_mode": "Set a transport mode",
  "mcp.resource.devices": "Devices",
  "mcp.resource.device_location": "A device's position",
  "link.view": "The link's page",
  "live.position": "Your new positions, live",
};

/** What someone you share with looked at: the same operations, seen from your side. */
const lookLabels: Readonly<Record<string, string>> = {
  listPeople: "Your position, in their People",
  getPerson: "Your position",
  getPersonTrack: "Your history",
  "mcp.get_people": "Your position, through their agent",
};

/** The words for an action; `people` reads the people's operations as looks at you. */
export function actionLabel(action: string, channel: DataAccessChannel): string {
  if (channel === "people") return lookLabels[action] ?? actionLabels[action] ?? action;
  return actionLabels[action] ?? action;
}

/** What a person's look at you was: where you are, where you were, a live update. */
export type LookKind = "position" | "history" | "live" | "other";

export function lookKindOf(action: string): LookKind {
  switch (action) {
    case "listPeople":
    case "getPerson":
    case "mcp.get_people":
      return "position";
    case "getPersonTrack":
      return "history";
    case "live.position":
      return "live";
    default:
      return "other";
  }
}

/** The channels as the pages call them. */
export const channelLabels: Readonly<Record<DataAccessChannel, string>> = {
  web: "Your browser",
  api: "API",
  mcp: "MCP server",
  people: "People",
  live: "Live updates",
  link: "Public link",
};

/** Kinds of actor, as a filter calls them. */
export const actorKindLabels: Readonly<Record<DataAccessActorKind, string>> = {
  person: "People you share with",
  link: "Link visitors",
  token: "API tokens",
  owner: "You",
};

/** The actions the access log can be filtered by: what tells who saw you and what changed. */
export const actionChoices: readonly {
  group: string;
  actions: readonly { action: string; label: string }[];
}[] = [
  {
    group: "Looks at you",
    actions: [
      { action: "listPeople", label: "Your position, in their People" },
      { action: "getPerson", label: "Your position" },
      { action: "getPersonTrack", label: "Your history" },
      { action: "live.position", label: "Your new positions, live" },
      { action: "link.view", label: "A public link's page" },
    ],
  },
  {
    group: "Downloads",
    actions: [{ action: "dashboard.export", label: "Exports" }],
  },
  {
    group: "Who may see you",
    actions: [
      { action: "createShare", label: "Started shares" },
      { action: "updateShare", label: "Changed shares" },
      { action: "confirmShare", label: "Confirmed shares" },
      { action: "deleteShare", label: "Stopped shares" },
      { action: "createShareLink", label: "Made public links" },
      { action: "deleteShareLink", label: "Turned off public links" },
      { action: "dashboard.createApiToken", label: "Created API tokens" },
      { action: "dashboard.updateApiToken", label: "Changed API tokens" },
      { action: "dashboard.rollApiToken", label: "Rolled API tokens" },
      { action: "dashboard.revokeApiToken", label: "Revoked API tokens" },
    ],
  },
  {
    group: "Changes to your data",
    actions: [
      { action: "setSegmentMode", label: "Corrected modes of moves" },
      { action: "resetSegmentMode", label: "Took back mode corrections" },
      { action: "setDeviceMode", label: "Set devices' transport modes" },
      { action: "mcp.set_transport_mode", label: "Transport modes set by an agent" },
      { action: "updateDevice", label: "Changed devices" },
      { action: "dashboard.deleteLocations", label: "Deleted periods" },
      { action: "dashboard.deleteDevice", label: "Deleted devices" },
    ],
  },
];
