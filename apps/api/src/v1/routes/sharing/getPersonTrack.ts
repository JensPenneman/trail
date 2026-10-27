import {
  personParamsSchema,
  personTrackQuerySchema,
  personTrackResponseSchema,
} from "@trail/contracts/person";
import { loadPersonTrack } from "../../../sharing/loadPersonTrack";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/people/{userId}/track` */
export const getPersonTrack = defineRoute(
  {
    method: "get",
    path: "/api/v1/people/{userId}/track",
    operationId: "getPersonTrack",
    summary: "Get a person's track",
    description:
      "Where a person has been, when their share includes history (history is only ever shared precisely): the recorded points of their shared devices in `[from, to)`, at most 93 days per call, split where recording paused and simplified to `maxPoints`, like your own tracks. A `from` before the shared history starts is moved up to it, so no older point is returned. A person without a share with history for you is 404. They can see in their data access log which range you looked at, and when.",
    tags: ["People"],
    auth: { scopes: ["people:read"] },
    request: { params: personParamsSchema, query: personTrackQuerySchema },
    responses: { 200: personTrackResponseSchema },
    access: { people: true },
  },
  async ({ ctx, auth, params, query }) => {
    const { track, shareId } = await loadPersonTrack(ctx, auth, params.userId, query);
    return {
      status: 200,
      body: track,
      owners: [
        {
          ownerUserId: params.userId,
          shareId,
          resource: {
            deviceIds: track.tracks.map((device) => device.deviceId),
            from: track.from,
            to: track.to,
          },
        },
      ],
    };
  },
);
