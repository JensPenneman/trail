import { segmentParamsSchema, segmentResponseSchema } from "@trail/contracts/transport";
import { clearSegmentMode } from "../../../transport/clearSegmentMode";
import { defineRoute } from "../../defineRoute";

/** `DELETE /api/v1/segments/{id}/mode` */
export const resetSegmentMode = defineRoute(
  {
    method: "delete",
    path: "/api/v1/segments/{id}/mode",
    operationId: "resetSegmentMode",
    summary: "Reset a move's mode",
    description:
      "Withdraws the correction that set the move's mode — a mode set from a moment on with it, for every move it covered — so the inferred mode counts again. The segment answers with the inferred mode at once; the span is worked out again within seconds (a `segments` event follows). Without a correction nothing changes.",
    tags: ["Timeline"],
    auth: { scopes: ["locations:write"] },
    request: { params: segmentParamsSchema },
    responses: { 200: segmentResponseSchema },
  },
  async ({ ctx, auth, params }) => {
    const { segment, revoked } = await clearSegmentMode(ctx.db, auth, params.id, {
      queue: ctx.processing.enabled,
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
