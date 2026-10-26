import type { V1Route } from "../../defineRoute";
import { getDeviceMode } from "./getDeviceMode";
import { getModeStats } from "./getModeStats";
import { getTracks } from "./getTracks";
import { listSegments } from "./listSegments";
import { resetSegmentMode } from "./resetSegmentMode";
import { setDeviceMode } from "./setDeviceMode";
import { setSegmentMode } from "./setSegmentMode";

/** Tracks at their levels, the timeline and the corrections of the mode, in the order of the reference. */
export const transportRoutes: readonly V1Route[] = [
  getTracks,
  listSegments,
  setSegmentMode,
  resetSegmentMode,
  getDeviceMode,
  setDeviceMode,
  getModeStats,
];
