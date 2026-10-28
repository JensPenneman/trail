import { timelineQuerySchema, timelineResponseSchema } from "@trail/contracts/transport";
import { dayStampsOf, dayValidator } from "../../../cache/dayStamps";
import { etagMatches } from "../../../cache/etagMatches";
import { stampRange } from "../../../cache/stampRange";
import { weakEtag } from "../../../cache/weakEtag";
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
      "The timeline: the stops and moves overlapping `[from, to)` (at most 93 days), oldest first, a page at a time. A stop has its place (`centroid`) and duration; a move its transport mode — the one a person set, else the inferred one — with the confidence, distance, duration and speeds. `pending` is true while points of the range still wait for processing, so the timeline may still change. `stamps` describe every device's local day of the range; send the `ETag` back as `If-None-Match` and the answer is `304` while they stay the same.",
    tags: ["Timeline"],
    auth: { scopes: ["locations:read"] },
    request: { query: timelineQuerySchema },
    responses: { 200: timelineResponseSchema, 304: null },
  },
  async ({ ctx, auth, query, ifNoneMatch }) => {
    const from = new Date(query.from);
    const to = new Date(query.to);
    // The stamps before the segments (docs/architecture.md §8.9).
    const { deviceIds, days } = await stampRange(ctx.db, auth, {
      deviceIds: query.devices,
      from,
      to,
    });
    const asked = {
      from: from.toISOString(),
      to: to.toISOString(),
      deviceIds,
      cursor: query.cursor ?? null,
      limit: query.limit,
    };
    const etag = weakEtag(auth.user.id, "listSegments", [asked, dayValidator(days, "processed")]);
    if (etagMatches(ifNoneMatch, etag)) return { status: 304, etag };
    const timeline = await loadTimeline(ctx.db, auth, {
      devices: deviceIds,
      from,
      to,
      cursor: query.cursor,
      limit: query.limit,
    });
    return { status: 200, body: { ...timeline, stamps: dayStampsOf(days) }, etag };
  },
);
