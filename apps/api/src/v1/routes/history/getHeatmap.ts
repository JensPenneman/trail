import {
  heatmapPublicQuerySchema,
  heatmapPublicResponseSchema,
} from "@trail/contracts/heatmapPublic";
import { findHeatCells } from "../../../heatmap/findHeatCells";
import { defineRoute } from "../../defineRoute";

/** `GET /api/v1/heatmap` */
export const getHeatmap = defineRoute(
  {
    method: "get",
    path: "/api/v1/heatmap",
    operationId: "getHeatmap",
    summary: "Get the heatmap",
    description:
      "How many points were ever recorded in each cell of a viewport, summed over the devices: the cells get smaller as `zoom` grows. Counted as points arrive, so it costs the same for a day of data as for ten years.",
    tags: ["History"],
    auth: { scopes: ["history:read"] },
    request: { query: heatmapPublicQuerySchema },
    // A device in `devices` that is unknown, foreign or outside the token is a 404.
    errors: [404],
    responses: { 200: heatmapPublicResponseSchema },
  },
  async ({ ctx, auth, query }) => ({
    status: 200,
    body: await findHeatCells(ctx.db, auth, {
      bbox: query.bbox,
      zoom: query.zoom,
      deviceIds: query.devices,
    }),
  }),
);
