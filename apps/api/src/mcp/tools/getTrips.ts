import { getTripsInputSchema, getTripsOutputSchema, mcpLimits } from "@trail/contracts/mcp";
import { findTrips } from "../../history/findTrips";
import { chooseDevices } from "../chooseDevice";
import { defineTool } from "../defineTool";
import { deviceRef } from "../deviceRef";
import { safeText } from "../safeText";
import { ownAccess } from "../toolAccess";
import { capItems, narrowTheRange, toolRange } from "../toolRange";
import { kmh } from "../units";
import { formatInZone } from "../zonedTime";

/** `get_trips` — trips recorded with Overland's trip recorder; no coordinates (`history:read`). */
export const getTrips = defineTool({
  name: "get_trips",
  title: "Get recorded trips",
  description: `The trips the owner recorded with the Start and Stop button of Overland's trip recorder that overlap the range: mode chosen in the app, start, end, duration, distance, average speed and steps. No coordinates. At most ${mcpLimits.maxRangeDays} days per call and ${mcpLimits.maxItems} trips per answer. For every journey, recorded or not, use get_timeline.`,
  scopes: ["history:read"],
  input: getTripsInputSchema,
  output: getTripsOutputSchema,
  access: "read",
  async run(input, context) {
    const { timeZone } = context;
    const range = toolRange(input.from, input.to);
    const devices = await chooseDevices(context.db, context.principal, input.device);
    const names = new Map(devices.map((device) => [device.id, deviceRef(device)]));
    const trips =
      devices.length === 0
        ? []
        : await findTrips(context.db, context.principal, {
            from: range.from.toISOString(),
            to: range.to.toISOString(),
            deviceIds: devices.map((device) => device.id),
          });
    const { items, truncated } = capItems(trips);
    const result = {
      from: formatInZone(range.from, timeZone),
      to: formatInZone(range.to, timeZone),
      trips: items.flatMap((trip) => {
        const device = names.get(trip.deviceId);
        if (device === undefined) return [];
        return [
          {
            device,
            mode: safeText(trip.mode, 40),
            startedAt: formatInZone(new Date(trip.startedAt), timeZone),
            endedAt: formatInZone(new Date(trip.endedAt), timeZone),
            durationS: Math.round(trip.durationS),
            distanceM: Math.round(trip.distanceM),
            averageSpeedKmh: trip.durationS > 0 ? kmh(trip.distanceM / trip.durationS) : null,
            steps: trip.steps,
            stoppedAutomatically: trip.stoppedAutomatically,
          },
        ];
      }),
      truncated,
    };
    const count = `${result.trips.length} trip${result.trips.length === 1 ? "" : "s"}`;
    return {
      result,
      text: `${count} from ${result.from} to ${result.to}.${truncated ? ` ${narrowTheRange}` : ""}`,
      items: result.trips.length,
      truncated,
      access: ownAccess(input.device === undefined ? null : devices, {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      }),
    };
  },
});
