import { historyRangeQuerySchema } from "@trail/contracts/query";
import { visitsPublicResponseSchema } from "@trail/contracts/visitPublic";
import { findVisits } from "../../../history/findVisits";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/visits` */
export const listVisits = defineRoute(
  {
    method: "get",
    path: "/api/v1/visits",
    operationId: "listVisits",
    summary: "List visits",
    description:
      "The places iOS saw the phones stay at (Overland with Visit Tracking on) that touch the range: arrived, departed or reported in it, or spanning it. At most 400 days at once. Visits are where someone was, so they need `locations:read`.",
    tags: ["Locations"],
    auth: { scopes: ["locations:read"] },
    request: { query: historyRangeQuerySchema },
    // A device in `devices` that is unknown, foreign or outside the token is a 404.
    errors: [404],
    responses: { 200: visitsPublicResponseSchema },
  },
  async ({ ctx, auth, query }) => ({
    status: 200,
    body: {
      visits: await findVisits(ctx.db, auth, {
        from: query.from,
        to: query.to,
        deviceIds: query.devices,
      }),
    },
  }),
);
