import { z } from "zod";
import { deviceIdsParamSchema } from "./query";

/** `bbox=west,south,east,north` in degrees. */
const bboxSchema = z
  .string()
  .transform((value) => value.split(",").map(Number))
  .pipe(
    z.tuple([
      z.number().min(-180).max(180),
      z.number().min(-90).max(90),
      z.number().min(-180).max(180),
      z.number().min(-90).max(90),
    ]),
  );

/** `GET /api/heatmap` — all-time density in the viewport, from pre-aggregated cells. */
export const heatmapQuerySchema = z.object({
  bbox: bboxSchema,
  /** Current map zoom; the server picks the matching cell resolution. */
  zoom: z.coerce.number().min(0).max(24),
  deviceIds: deviceIdsParamSchema.optional(),
});
export type HeatmapQueryInput = z.input<typeof heatmapQuerySchema>;

export const heatmapResponseSchema = z.object({
  /** Slippy-tile zoom of the cells. */
  cellZoom: z.number().int(),
  /** `[lon, lat, count]` of each cell centre. */
  cells: z.array(z.tuple([z.number(), z.number(), z.number().int().positive()])),
  /** True when the viewport held more cells than the response limit. */
  truncated: z.boolean(),
});
export type HeatmapResponse = z.infer<typeof heatmapResponseSchema>;
