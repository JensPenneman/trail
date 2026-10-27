import { getVisitsInputSchema, getVisitsOutputSchema, mcpLimits } from "@trail/contracts/mcp";
import { findVisits } from "../../history/findVisits";
import { chooseDevices } from "../chooseDevice";
import { defineTool } from "../defineTool";
import { deviceRef } from "../deviceRef";
import { capItems, narrowTheRange, toolRange } from "../toolRange";
import { oneDecimal, secondsBetween } from "../units";
import { formatInZone } from "../zonedTime";

/** `get_visits` — the places iOS saw the phones stay at (visits are places: `locations:read`). */
export const getVisits = defineTool({
  name: "get_visits",
  title: "Get visits",
  description: `The places iOS saw the phones stay at (Overland's visit tracking) that touch the range: arrival, departure, duration and the place (WGS84). At most ${mcpLimits.maxRangeDays} days per call and ${mcpLimits.maxItems} visits per answer. For stops worked out from every recorded point, with how the device travelled in between, use get_timeline.`,
  scopes: ["locations:read"],
  input: getVisitsInputSchema,
  output: getVisitsOutputSchema,
  access: "read",
  async run(input, context) {
    const { timeZone } = context;
    const range = toolRange(input.from, input.to);
    const devices = await chooseDevices(context.db, context.principal, input.device);
    const names = new Map(devices.map((device) => [device.id, deviceRef(device)]));
    const visits =
      devices.length === 0
        ? []
        : await findVisits(context.db, context.principal, {
            from: range.from.toISOString(),
            to: range.to.toISOString(),
            deviceIds: devices.map((device) => device.id),
          });
    const { items, truncated } = capItems(visits);
    const result = {
      from: formatInZone(range.from, timeZone),
      to: formatInZone(range.to, timeZone),
      visits: items.flatMap((visit) => {
        const device = names.get(visit.deviceId);
        if (device === undefined) return [];
        const arrived = visit.arrivedAt === null ? null : new Date(visit.arrivedAt);
        const departed = visit.departedAt === null ? null : new Date(visit.departedAt);
        return [
          {
            device,
            arrivedAt: arrived === null ? null : formatInZone(arrived, timeZone),
            departedAt: departed === null ? null : formatInZone(departed, timeZone),
            durationS:
              arrived === null || departed === null ? null : secondsBetween(arrived, departed),
            lat: visit.lat,
            lon: visit.lon,
            accuracyM: oneDecimal(visit.accuracy),
          },
        ];
      }),
      truncated,
    };
    const count = `${result.visits.length} visit${result.visits.length === 1 ? "" : "s"}`;
    return {
      result,
      text: `${count} from ${result.from} to ${result.to}.${truncated ? ` ${narrowTheRange}` : ""}`,
      items: result.visits.length,
      truncated,
    };
  },
});
