import {
  moveOverHint,
  segmentParamsSchema,
  segmentResponseSchema,
} from "@trail/contracts/transport";
import { clearSegmentMode } from "../../../transport/clearSegmentMode";
import { defineRoute } from "../../defineRoute";

/** `DELETE /api/v1/segments/{id}/mode` */
export const resetSegmentMode = defineRoute(
  {
    method: "delete",
    path: "/api/v1/segments/{id}/mode",
    operationId: "resetSegmentMode",
    summary: "Reset a move's mode",
    description: `Withdraws the correction that set the move's mode — a mode set from a moment on with it, for every move it covered — so the inferred mode counts again. The segment answers with the inferred mode at once; the span is worked out again within seconds (a \`segments\` event follows). Without a correction nothing changes. A move that is still under way cannot be reset until it is over (${moveOverHint}): \`409\`. While a long pass over the device's data runs it waits up to 10 seconds for it, then answers \`409\` (try again).`,
    tags: ["Timeline"],
    // The answer carries the segment or the current mode: location data.
    auth: { scopes: ["locations:read", "locations:write"], all: true },
    request: { params: segmentParamsSchema },
    responses: { 200: segmentResponseSchema },
    errors: [409],
  },
  async ({ ctx, auth, params }) => {
    const { segment, revoked } = await clearSegmentMode(ctx.db, auth, params.id, {
      queue: ctx.processing.enabled,
      lockWaitMs: ctx.config.processing.correctionWaitMs,
      railAlign: ctx.config.processing.railAlign,
    });
    if (revoked.length > 0) {
      ctx.processing.notify();
      ctx.bus.publish(auth.user.id, {
        type: "segments",
        deviceId: segment.deviceId,
        from: segment.startedAt,
        to: segment.endedAt,
      });
    }
    return { status: 200, body: { segment } };
  },
);
