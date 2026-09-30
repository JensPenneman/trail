import { z } from "zod";
import { deviceIdsParamSchema, instantRange } from "./query";

/** `GET /api/export` — downloads points as a file (streamed, `Content-Disposition: attachment`). */
export const exportFormats = ["geojson", "gpx", "csv"] as const;

export const exportQuerySchema = instantRange(36_600).and(
  z.object({
    format: z.enum(exportFormats),
    deviceIds: deviceIdsParamSchema.optional(),
  }),
);
export type ExportQueryInput = z.input<typeof exportQuerySchema>;
