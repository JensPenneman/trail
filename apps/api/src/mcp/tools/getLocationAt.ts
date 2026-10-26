import {
  getLocationAtInputSchema,
  getLocationAtOutputSchema,
  mcpLimits,
} from "@trail/contracts/mcp";
import type { Executor } from "../../db/database";
import { type LocationRecord, readPoints } from "../../locations/readPoints";
import { chooseDevice } from "../chooseDevice";
import { defineTool } from "../defineTool";
import { deviceRef, quoted } from "../deviceRef";
import { presentMotion } from "../presentMotion";
import { kmh, oneDecimal, secondsBetween } from "../units";
import { formatInZone } from "../zonedTime";

/** Of the last point at or before `at` and the first one after it, the one closer in time (the earlier on a tie). */
export function nearestInTime<P extends { recordedAt: Date }>(
  at: Date,
  before: P | undefined,
  after: P | undefined,
): P | undefined {
  if (before === undefined) return after;
  if (after === undefined) return before;
  const gapBefore = at.getTime() - before.recordedAt.getTime();
  const gapAfter = after.recordedAt.getTime() - at.getTime();
  return gapAfter < gapBefore ? after : before;
}

/** The recorded point of one device nearest to `at`, at most `toleranceMs` away; two index lookups. */
async function nearestPoint(
  db: Executor,
  deviceId: string,
  at: Date,
  toleranceMs: number,
): Promise<LocationRecord | undefined> {
  const justAfter = new Date(at.getTime() + 1);
  const [before] = (
    await readPoints(db, deviceId, {
      order: "desc",
      from: new Date(at.getTime() - toleranceMs),
      to: justAfter,
      limit: 1,
    })
  ).rows;
  const [after] = (
    await readPoints(db, deviceId, {
      order: "asc",
      from: justAfter,
      to: new Date(at.getTime() + toleranceMs + 1),
      limit: 1,
    })
  ).rows;
  return nearestInTime(at, before, after);
}

/** `get_location_at` — where a device was at a moment: the recorded point nearest to it. */
export const getLocationAt = defineTool({
  name: "get_location_at",
  title: "Get the location at a time",
  description: `Where a device was at a moment: the recorded position nearest to \`at\` (WGS84), within \`toleranceMinutes\` before or after it (default ${mcpLimits.defaultToleranceMinutes}, at most ${mcpLimits.maxToleranceMinutes}), with how far it lies from \`at\` in seconds. \`location\` is null when nothing was recorded that close. Without \`device\`, the device that reported a position most recently.`,
  scopes: ["locations:read"],
  input: getLocationAtInputSchema,
  output: getLocationAtOutputSchema,
  access: "read",
  async run(input, context) {
    const { timeZone } = context;
    const at = new Date(input.at);
    const toleranceMinutes = input.toleranceMinutes ?? mcpLimits.defaultToleranceMinutes;
    const summary = await chooseDevice(context.db, context.principal, input.device);
    const point = await nearestPoint(context.db, summary.id, at, toleranceMinutes * 60_000);
    const device = deviceRef(summary);
    const location =
      point === undefined
        ? null
        : {
            lat: point.lat,
            lon: point.lon,
            accuracyM: oneDecimal(point.horizontalAccuracy),
            recordedAt: formatInZone(point.recordedAt, timeZone),
            offsetS: secondsBetween(at, point.recordedAt),
            speedKmh: kmh(point.speed),
            altitudeM: oneDecimal(point.altitude),
            courseDeg: oneDecimal(point.course),
            motion: presentMotion(point.motion ?? []),
          };
    const asked = formatInZone(at, timeZone);
    return {
      result: { device, at: asked, toleranceMinutes, location },
      text:
        location === null
          ? `${quoted(device.name)} recorded no position within ${toleranceMinutes} minutes of ${asked}.`
          : `${quoted(device.name)} was at ${location.lat}, ${location.lon} at ${location.recordedAt} (${location.offsetS} s from ${asked}).`,
    };
  },
});
