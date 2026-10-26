import type { ApiScope } from "@trail/contracts/apiScope";

/**
 * Whether a principal may read the positions of its own devices — the precise
 * own devices `resolveAccessibleDevices` returns, and a distance from "me" —
 * which for a token takes `locations:read`. A session holds every scope.
 */
export const mayReadOwnLocations = (viewer: {
  readonly kind?: "session" | "token";
  readonly scopes?: readonly ApiScope[];
}): boolean => viewer.kind !== "token" || viewer.scopes?.includes("locations:read") === true;
