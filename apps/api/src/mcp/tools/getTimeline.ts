import {
  type GetTimelineOutput,
  getTimelineInputSchema,
  getTimelineOutputSchema,
  mcpLimits,
} from "@trail/contracts/mcp";
import { loadTimeline } from "../../transport/loadTimeline";
import { chooseDevices } from "../chooseDevice";
import { defineTool } from "../defineTool";
import { deviceRef } from "../deviceRef";
import { narrowTheRange, toolRange } from "../toolRange";
import { kmh } from "../units";
import { formatInZone } from "../zonedTime";

type TimelineItem = GetTimelineOutput["items"][number];

/** `get_timeline` — stops and moves with their modes: the appointment agent's main tool. */
export const getTimeline = defineTool({
  name: "get_timeline",
  title: "Get the timeline",
  description: `The stops and moves Trail worked out from the recorded points, oldest first. A stop has its place (WGS84), arrival, departure and duration; a move its transport mode (and whether the owner set it), confidence, distance, duration and average speed. Use it to see where the owner was and how long journeys took, for example to plan appointments around real travel times. At most ${mcpLimits.maxRangeDays} days per call and ${mcpLimits.maxItems} items per answer; \`pending\` says when recent points still wait to be processed.`,
  scopes: ["locations:read"],
  input: getTimelineInputSchema,
  output: getTimelineOutputSchema,
  access: "read",
  async run(input, context) {
    const { timeZone } = context;
    const range = toolRange(input.from, input.to);
    const devices = await chooseDevices(context.db, context.principal, input.device);
    const names = new Map(devices.map((device) => [device.id, deviceRef(device)]));
    const timeline =
      devices.length === 0
        ? { items: [], nextCursor: null, pending: false }
        : await loadTimeline(context.db, context.principal, {
            devices: devices.map((device) => device.id),
            from: range.from,
            to: range.to,
            limit: mcpLimits.maxItems,
          });
    const truncated = timeline.nextCursor !== null;
    const zoned = (value: string) => formatInZone(new Date(value), timeZone);
    const items = timeline.items.flatMap((segment): TimelineItem[] => {
      const device = names.get(segment.deviceId);
      if (device === undefined) return [];
      const common = {
        device,
        startedAt: zoned(segment.startedAt),
        endedAt: zoned(segment.endedAt),
        durationS: Math.round(segment.durationS),
      };
      if (segment.kind === "stop") {
        return [
          {
            kind: "stop",
            ...common,
            place: { lat: segment.centroid.lat, lon: segment.centroid.lon },
          },
        ];
      }
      return [
        {
          kind: "move",
          ...common,
          mode: segment.mode ?? "unknown",
          modeSetByUser: segment.modeUser !== null,
          confidence: segment.confidence,
          needsReview: segment.needsReview,
          distanceM: Math.round(segment.distanceM),
          averageSpeedKmh: kmh(segment.averageSpeed),
        },
      ];
    });
    const result = {
      from: formatInZone(range.from, timeZone),
      to: formatInZone(range.to, timeZone),
      items,
      pending: timeline.pending,
      truncated,
    };
    const stops = items.filter((item) => item.kind === "stop").length;
    const moves = items.length - stops;
    return {
      result,
      text: `${stops} stop${stops === 1 ? "" : "s"} and ${moves} move${moves === 1 ? "" : "s"} from ${result.from} to ${result.to}.${
        timeline.pending ? " Some points still wait to be processed." : ""
      }${truncated ? ` ${narrowTheRange}` : ""}`,
      items: items.length,
      truncated,
    };
  },
});
