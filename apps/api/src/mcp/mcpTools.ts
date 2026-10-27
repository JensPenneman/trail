import type { McpTool } from "./defineTool";
import { getCurrentLocation } from "./tools/getCurrentLocation";
import { getDaySummary } from "./tools/getDaySummary";
import { getLocationAt } from "./tools/getLocationAt";
import { getPeople } from "./tools/getPeople";
import { getTimeline } from "./tools/getTimeline";
import { getTrips } from "./tools/getTrips";
import { getVisits } from "./tools/getVisits";
import { listDevices } from "./tools/listDevices";
import { setTransportMode } from "./tools/setTransportMode";

/**
 * Every tool of Trail's MCP server, in the order `tools/list` gives them (a
 * stable order lets clients cache the list). A token sees the ones whose
 * scopes it holds, all of them (docs/mcp.md).
 */
export const mcpTools: readonly McpTool[] = [
  listDevices,
  getCurrentLocation,
  getLocationAt,
  getTimeline,
  getDaySummary,
  getVisits,
  getTrips,
  setTransportMode,
  getPeople,
];
