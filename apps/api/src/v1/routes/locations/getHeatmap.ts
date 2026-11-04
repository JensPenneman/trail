import {
  heatmapPublicQuerySchema,
  heatmapPublicResponseSchema,
} from "@trail/contracts/heatmapPublic";
import { findHeatCells } from "../../../heatmap/findHeatCells";
import { tileCentre } from "../../../heatmap/tileMath";
import { defineRoute } from "../../defineRoute";

/** The most cells `/api/v1/heatmap` answers. */
const publicCellLimit = 20_000;

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/** `GET /api/v1/heatmap` */
export const getHeatmap = defineRoute(
  {
    method: "get",
    path: "/api/v1/heatmap",
    operationId: "getHeatmap",
    summary: "Get the heatmap",
    description:
      "How many points were ever recorded in each cell of a viewport, summed over the devices: the cells get smaller as `zoom` grows. Counted as points arrive, so it costs the same for a day of data as for ten years. The cells are places, so the heatmap needs `locations:read`.",
    tags: ["Locations"],
    auth: { scopes: ["locations:read"] },
    request: { query: heatmapPublicQuerySchema },
    // A device in `devices` that is unknown, foreign or outside the token is a 404.
    errors: [404],
    responses: { 200: heatmapPublicResponseSchema },
  },
  async ({ ctx, auth, query }) => {
    // The cells as centres `[lon, lat, count]`, at most 20 000: the shape of this operation.
    const found = await findHeatCells(
      ctx.db,
      auth,
      { bbox: query.bbox, zoom: query.zoom, deviceIds: query.devices },
      { limit: publicCellLimit },
    );
    return {
      status: 200,
      body: {
        cellZoom: found.cellZoom,
        cells: found.cells.map(([x, y, count]) => {
          const [lon, lat] = tileCentre(x, y, found.cellZoom);
          return [round6(lon), round6(lat), count] as [number, number, number];
        }),
        truncated: found.truncated,
      },
    };
  },
);
