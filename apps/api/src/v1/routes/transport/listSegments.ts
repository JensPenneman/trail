import { timelineQuerySchema, timelineResponseSchema } from "@trail/contracts/transport";
import { loadTimeline } from "../../../transport/loadTimeline";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/segments` */
export const listSegments = defineRoute(
  {
    method: "get",
    path: "/api/v1/segments",
    operationId: "listSegments",
    summary: "List stops and moves",
    description:
      "The timeline: the stops and moves overlapping `[from, to)` (at most 93 days), oldest first, a page at a time. A stop has its place (`centroid`) and duration; a move its transport mode — the one a person set, else the inferred one — with the confidence, distance, duration and speeds. `pending` is true while points of the range still wait for processing, so the timeline may still change.",
    tags: ["Timeline"],
    auth: { scopes: ["locations:read"] },
    request: { query: timelineQuerySchema },
    responses: { 200: timelineResponseSchema },
  },
  async ({ ctx, auth, query }) => ({
    status: 200,
    body: await loadTimeline(ctx.db, auth, {
      devices: query.devices,
      from: new Date(query.from),
      to: new Date(query.to),
      cursor: query.cursor,
      limit: query.limit,
    }),
  }),
);
