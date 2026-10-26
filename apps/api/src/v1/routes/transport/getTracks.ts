import { levelTracksQuerySchema, levelTracksResponseSchema } from "@trail/contracts/transport";
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
      "The tracks of the devices in `[from, to)` (at most 93 days) at a level of calculation: `raw` as recorded, `averaged` (outliers dropped, GPS noise smoothed), `mapped` (snapped to roads and railways, with the way's shape between points) or `inferred` (the stops and moves of the timeline, each move with its transport mode). A point that has not reached the level yet is served at the best one below it, and `availableLevel` says which level every point reached. Each device's track is simplified to at most `maxPoints`.",
    tags: ["Tracks"],
    auth: { scopes: ["locations:read"] },
    request: { query: levelTracksQuerySchema },
    responses: { 200: levelTracksResponseSchema },
  },
  async ({ ctx, auth, query }) => ({
    status: 200,
    body: await loadLevelTracks(ctx.db, auth, {
      devices: query.devices,
      from: new Date(query.from),
      to: new Date(query.to),
      level: query.level,
      maxPoints: query.maxPoints,
    }),
  }),
);
