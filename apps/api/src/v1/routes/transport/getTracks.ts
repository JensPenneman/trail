import { levelTracksQuerySchema, levelTracksResponseSchema } from "@trail/contracts/transport";
import { dayStampsOf, dayValidator } from "../../../cache/dayStamps";
import { etagMatches } from "../../../cache/etagMatches";
import { stampRange } from "../../../cache/stampRange";
import { weakEtag } from "../../../cache/weakEtag";
import { loadLevelTracks } from "../../../transport/loadLevelTracks";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/tracks` */
export const getTracks = defineRoute(
  {
    method: "get",
    path: "/api/v1/tracks",
    operationId: "getTracks",
    summary: "Get tracks at a level",
    description:
      "The tracks of the devices in `[from, to)` (at most 93 days) at a level of calculation: `raw` as recorded, `averaged` (outliers dropped, GPS noise smoothed), `mapped` (snapped to roads and railways, with the way's shape between points) or `inferred` (the stops and moves of the timeline, each move with its transport mode). A point that has not reached the level yet is served at the best one below it, and `availableLevel` says which level every point reached. Each device's track is simplified to at most `maxPoints`. `stamps` describe every device's local day of the range; send the `ETag` back as `If-None-Match` and the answer is `304` while they stay the same.",
    tags: ["Tracks"],
    auth: { scopes: ["locations:read"] },
    request: { query: levelTracksQuerySchema },
    responses: { 200: levelTracksResponseSchema, 304: null },
  },
  async ({ ctx, auth, query, ifNoneMatch }) => {
    const from = new Date(query.from);
    const to = new Date(query.to);
    // The stamps before the points (docs/architecture.md §8.9).
    const { deviceIds, days } = await stampRange(ctx.db, auth, {
      deviceIds: query.devices,
      from,
      to,
    });
    const asked = {
      from: from.toISOString(),
      to: to.toISOString(),
      deviceIds,
      level: query.level,
      maxPoints: query.maxPoints,
    };
    // The raw level needs nothing of processing.
    const parts = query.level === "raw" ? "raw" : "processed";
    const etag = weakEtag(auth.user.id, "getTracks", [asked, dayValidator(days, parts)]);
    if (etagMatches(ifNoneMatch, etag)) return { status: 304, etag };
    const tracks = await loadLevelTracks(ctx.db, auth, {
      devices: deviceIds,
      from,
      to,
      level: query.level,
      maxPoints: query.maxPoints,
    });
    return { status: 200, body: { ...tracks, stamps: dayStampsOf(days) }, etag };
  },
);
