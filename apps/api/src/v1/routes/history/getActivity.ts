import { activityQuerySchema, activityResponseSchema } from "@trail/contracts/statsPublic";
import { findActivity } from "../../../stats/findActivity";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/stats/activity` */
export const getActivity = defineRoute(
  {
    method: "get",
    path: "/api/v1/stats/activity",
    operationId: "getActivity",
    summary: "Get recent activity",
    description:
      "Points recorded and uploads received per device and UTC hour, over the last `hours` hours up to the current one, zeros included: the quickest way to see whether data still comes in.",
    tags: ["History"],
    auth: { scopes: ["history:read"] },
    request: { query: activityQuerySchema },
    // A device in `devices` that is unknown, foreign or outside the token is a 404.
    errors: [404],
    responses: { 200: activityResponseSchema },
  },
  async ({ ctx, auth, query }) => ({
    status: 200,
    body: await findActivity(ctx.db, auth, { hours: query.hours, deviceIds: query.devices }),
  }),
);
