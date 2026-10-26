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
    description: "The map's zoom level; the cells get finer as it grows.",
    example: 12,
  }),
  devices: devicesParamSchema.optional(),
});
export type HeatmapPublicQueryInput = z.input<typeof heatmapPublicQuerySchema>;

export const heatmapPublicResponseSchema = z
  .object({
    cellZoom: z.number().int().meta({
      description: "Slippy-map zoom of the cells (6, 9, 12, 15 or 18).",
      example: 15,
    }),
    cells: z.array(z.tuple([z.number(), z.number(), z.number().int().positive()])).meta({
      description:
        "`[lon, lat, count]` of each cell centre with points, busiest first, at most 20 000.",
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
