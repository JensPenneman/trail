import type { WayKind } from "@trail/contracts/transport";
import type { WayShares } from "./pipelineTypes";

/** The share of `WayShares` a way kind counts towards. */
export function wayFamilyOf(kind: WayKind | null): keyof WayShares {
  switch (kind) {
    case "rail":
      return "rail";
    case "subway":
      return "subway";
    case "tram":
    case "light_rail":
      return "tram";
    case "motorway":
    case "trunk":
      return "motorway";
    case "primary":
    case "secondary":
    case "tertiary":
    case "residential":
    case "service":
    case "track":
      return "road";
    case "cycleway":
      return "cycleway";
    case "footway":
    case "path":
      return "foot";
    case "ferry":
      return "ferry";
    default:
      return "none";
  }
}

export const emptyShares = (): WayShares => ({
  rail: 0,
  subway: 0,
  tram: 0,
  motorway: 0,
  road: 0,
  cycleway: 0,
  foot: 0,
  ferry: 0,
  none: 0,
});
