import { historyRangeQuerySchema } from "@trail/contracts/query";
import { tripsPublicResponseSchema } from "@trail/contracts/tripPublic";
import { findTrips } from "../../../history/findTrips";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/trips` */
export const listTrips = defineRoute(
  {
    method: "get",
    path: "/api/v1/trips",
    operationId: "listTrips",
    summary: "List trips",
    description:
      "The trips recorded with Overland's Start and Stop button that overlap the range. At most 400 days at once.",
    tags: ["History"],
    auth: { scopes: ["history:read"] },
    request: { query: historyRangeQuerySchema },
    // A device in `devices` that is unknown, foreign or outside the token is a 404.
    errors: [404],
    responses: { 200: tripsPublicResponseSchema },
  },
  async ({ ctx, auth, query }) => ({
    status: 200,
    body: {
      trips: await findTrips(ctx.db, auth, {
        from: query.from,
        to: query.to,
        deviceIds: query.devices,
      }),
    },
  }),
);
