import { z } from "zod";
import { bboxParamSchema } from "./heatmap";
import { devicesParamSchema } from "./query";

/* The all-time heatmap as the public API (v1) shows it. */

/** `GET /api/v1/heatmap` */
export const heatmapPublicQuerySchema = z.object({
  bbox: bboxParamSchema.meta({
    description:
      "The viewport: `west,south,east,north` in degrees (west > east crosses the antimeridian).",
    example: "3.60,50.98,3.80,51.10",
  }),
  zoom: z.coerce.number().min(0).max(24).meta({
    description:
      "The map's zoom level (MapLibre's, with 512-pixel tiles); the cells get finer as it grows, about 16 pixels wide at that zoom.",
    example: 12,
  }),
  devices: devicesParamSchema.optional(),
});
export type HeatmapPublicQueryInput = z.input<typeof heatmapPublicQuerySchema>;

export const heatmapPublicResponseSchema = z
  .object({
    cellZoom: z.number().int().meta({
      description:
        "Slippy-map zoom of the cells, from 6 to 20: the rounded `zoom` + 5. A cell is the slippy-map tile of that zoom.",
      example: 17,
    }),
    cells: z.array(z.tuple([z.number(), z.number(), z.number().int().positive()])).meta({
      description:
        "`[lon, lat, count]` of each cell centre with points, busiest first, at most 20 000. A cell at the edge of the viewport counts all of its points.",
      example: [
        [3.7174, 51.0543, 1820],
        [3.7251, 51.0498, 640],
      ],
    }),
    truncated: z.boolean().meta({
      description: "True when the viewport held more cells than the answer carries.",
      example: false,
    }),
  })
  .meta({
    id: "Heatmap",
    description:
      "How many points were ever recorded in each cell of the viewport; points less accurate than 200 m are left out.",
  });
export type HeatmapPublicResponse = z.infer<typeof heatmapPublicResponseSchema>;
