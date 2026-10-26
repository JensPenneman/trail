import type { Viewer } from "./accessibleDevices";

/**
 * Whether the viewer's own positions may be used for what it is shown: a
 * distance from "me" is location data of the viewer's devices, so a token
 * needs `locations:read` for it.
 */
export const mayReadOwnLocations = (viewer: Viewer): boolean =>
  viewer.kind !== "token" || viewer.scopes?.includes("locations:read") === true;
