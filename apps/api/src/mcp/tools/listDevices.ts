import { deviceStatus } from "@trail/contracts/deviceStatus";
import {
  type ListDevicesOutput,
  listDevicesInputSchema,
  listDevicesOutputSchema,
} from "@trail/contracts/mcp";
import { loadDeviceSummaries } from "../../devices/loadDeviceSummaries";
import { currentModeOf } from "../currentModeOf";
import { defineTool, type ToolAnswer } from "../defineTool";
import { quoted } from "../deviceRef";
import { presentBattery } from "../presentBattery";
import type { WorkContext } from "../runMcpWork";
import { safeText } from "../safeText";
import { formatInZone } from "../zonedTime";

const zoned = (value: string | null, timeZone: string): string | null =>
  value === null ? null : formatInZone(new Date(value), timeZone);

/**
 * The devices the token reaches, their freshness, battery and mode — never
 * where they are: `list_devices` and the `trail://devices` resource.
 */
export async function devicesAnswer(context: WorkContext): Promise<ToolAnswer<ListDevicesOutput>> {
  const { ctx, timeZone, now } = context;
  const summaries = await loadDeviceSummaries(context.db, context.principal);
  const thresholds = {
    liveMinutes: ctx.config.liveWindowMinutes,
    staleHours: ctx.config.staleAfterHours,
  };
  const devices = [];
  for (const summary of summaries) {
    devices.push({
      id: summary.id,
      name: safeText(summary.name),
      status: deviceStatus(summary.lastSeenAt, now, thresholds),
      lastSeenAt: zoned(summary.lastSeenAt, timeZone),
      lastPositionAt: zoned(summary.lastLocation?.recordedAt ?? null, timeZone),
      battery: presentBattery(summary.battery, timeZone),
      liveTrip:
        summary.liveTrip === null
          ? null
          : {
              mode: safeText(summary.liveTrip.mode, 40),
              startedAt: formatInZone(new Date(summary.liveTrip.startedAt), timeZone),
              distanceM: Math.round(summary.liveTrip.distanceM),
            },
      currentMode: await currentModeOf(context, summary.id),
    });
  }
  const lines = devices.map((device) => {
    const upload = device.lastSeenAt === null ? "" : `, last upload ${device.lastSeenAt}`;
    const level = device.battery?.levelPercent;
    const battery = level === undefined || level === null ? "" : `, battery ${level} %`;
    return `${quoted(device.name)} (${device.id}): ${device.status}${upload}${battery}`;
  });
  return {
    result: { devices },
    text:
      devices.length === 0
        ? "This token reaches no device."
        : `${devices.length} device${devices.length === 1 ? "" : "s"}:\n${lines.join("\n")}`,
    items: devices.length,
  };
}

/** `list_devices` */
export const listDevices = defineTool({
  name: "list_devices",
  title: "List devices",
  description:
    "Lists the account's devices (phones running Overland) that this token reaches: id, name, whether data still comes in (status, last upload), battery, a trip running in Overland and how the device travels now. No positions: get_current_location has those. Call it first to learn the device ids and names the other tools take.",
  scopes: ["devices:read"],
  input: listDevicesInputSchema,
  output: listDevicesOutputSchema,
  access: "read",
  run: (_input, context) => devicesAnswer(context),
});
