import {
  type GetCurrentLocationOutput,
  getCurrentLocationInputSchema,
  getCurrentLocationOutputSchema,
} from "@trail/contracts/mcp";
import { chooseDevice } from "../chooseDevice";
import { currentModeOf } from "../currentModeOf";
import { defineTool, type ToolAnswer } from "../defineTool";
import { deviceRef, quoted } from "../deviceRef";
import { presentBattery } from "../presentBattery";
import { presentMotion } from "../presentMotion";
import type { WorkContext } from "../runMcpWork";
import { kmh, oneDecimal, secondsBetween } from "../units";
import { formatInZone } from "../zonedTime";

/**
 * Where a device is now — its newest known position, battery and mode:
 * `get_current_location` and the `trail://devices/{id}/location` resource.
 */
export async function currentLocationAnswer(
  context: WorkContext,
  deviceArgument: string | undefined,
): Promise<ToolAnswer<GetCurrentLocationOutput>> {
  const { timeZone, now } = context;
  const summary = await chooseDevice(context.db, context.principal, deviceArgument);
  const position = summary.lastLocation;
  const location =
    position === null
      ? null
      : {
          lat: position.lat,
          lon: position.lon,
          accuracyM: oneDecimal(position.accuracy),
          recordedAt: formatInZone(new Date(position.recordedAt), timeZone),
          ageS: Math.max(0, secondsBetween(new Date(position.recordedAt), now)),
          speedKmh: kmh(position.speed),
          altitudeM: oneDecimal(position.altitude),
          courseDeg: oneDecimal(position.course),
          motion: presentMotion(position.motion),
        };
  const device = deviceRef(summary);
  const result = {
    device,
    location,
    battery: presentBattery(summary.battery, timeZone),
    currentMode: await currentModeOf(context, summary.id),
  };
  if (location === null) {
    return { result, text: `${quoted(device.name)} has not sent a position yet.` };
  }
  const accuracy = location.accuracyM === null ? "" : ` (±${location.accuracyM} m)`;
  return {
    result,
    text: `${quoted(device.name)} was at ${location.lat}, ${location.lon}${accuracy} at ${location.recordedAt}, ${location.ageS} s ago.`,
  };
}

/** `get_current_location` — where a device is now: its newest known position. */
export const getCurrentLocation = defineTool({
  name: "get_current_location",
  title: "Get the current location",
  description:
    "Where a device is now: its newest known position (WGS84 latitude and longitude, accuracy radius in metres), how old that position is, speed, motion, how it travels now and the battery. Without `device`, the device that reported a position most recently. A position can be minutes or hours old while the phone stands still: check `ageS`.",
  scopes: ["locations:read"],
  input: getCurrentLocationInputSchema,
  output: getCurrentLocationOutputSchema,
  access: "read",
  run: (input, context) => currentLocationAnswer(context, input.device),
});
