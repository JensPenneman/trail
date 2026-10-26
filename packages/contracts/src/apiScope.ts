import { z } from "zod";

/**
 * What an API token may do. A v1 operation lists the scopes that grant access
 * to it; a signed-in browser session holds every scope.
 */
export const apiScopes = [
  "profile:read",
  "devices:read",
  "devices:write",
  "locations:read",
  "locations:write",
  "history:read",
  "people:read",
  "shares:read",
  "shares:write",
] as const;

export const apiScopeSchema = z
  .enum(apiScopes)
  .meta({ id: "ApiScope", description: "A permission of an API token.", example: "devices:read" });
export type ApiScope = z.infer<typeof apiScopeSchema>;

/** What each scope allows, in a sentence (the API reference, the token dialog). */
export const apiScopeDescriptions: Record<ApiScope, string> = {
  "profile:read": "Read the account's name and time zone.",
  "devices:read":
    "List the devices with their name, status, last-seen time and battery, not where they are.",
  "devices:write":
    "Rename devices, switch their alerts and queue settings presets; never their tokens.",
  "locations:read":
    "Read positions: where the devices are now and where they have been (points, visits, the heatmap, tracks, the timeline).",
  "locations:write": "Correct how you travelled (transport mode overrides).",
  "history:read": "Read trips, daily statistics and activity: the history without coordinates.",
  "people:read": "See the people who share their location with you.",
  "shares:read": "List your shares, the ones you receive and your public links.",
  "shares:write": "Start and stop sharing, hide people and manage public links.",
};
