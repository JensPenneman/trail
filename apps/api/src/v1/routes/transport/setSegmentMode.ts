import {
  segmentParamsSchema,
  segmentResponseSchema,
  setSegmentModeRequestSchema,
} from "@trail/contracts/transport";
import { setSegmentMode as applySegmentMode } from "../../../transport/setSegmentMode";
import { defineRoute } from "../../defineRoute";
import { principalSource } from "./principalSource";

/** `PUT /api/v1/segments/{id}/mode` */
export const setSegmentMode = defineRoute(
  {
    method: "put",
    path: "/api/v1/segments/{id}/mode",
    operationId: "setSegmentMode",
    summary: "Set a move's mode",
    description:
      "Corrects the transport mode of a move: the mode applies to the move's time and wins over the inference, also when the history is processed again. The inferred mode stays visible as `modeInferred`. Setting the mode it already has changes nothing. A stop has no mode: `409`.",
    tags: ["Timeline"],
    // The answer carries the segment or the current mode: location data.
    auth: { scopes: ["locations:read", "locations:write"], all: true },
    request: { params: segmentParamsSchema, body: setSegmentModeRequestSchema },
    responses: { 200: segmentResponseSchema },
    errors: [409],
  },
  async ({ ctx, auth, params, body }) => {
    const segment = await applySegmentMode(
      ctx.db,
      auth,
      params.id,
      body.mode,
      principalSource(auth),
    );
    ctx.bus.publish(auth.user.id, {
      type: "segments",
      deviceId: segment.deviceId,
      from: segment.startedAt,
      to: segment.endedAt,
    });
    return { status: 200, body: { segment } };
  },
);
