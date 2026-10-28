import { z } from "zod";
import { dayStampsSchema } from "./cacheStamp";
import { deviceIdsParamSchema, instantRange } from "./query";

/** Shared query of `GET /api/visits` and `GET /api/trips`. */
export const eventRangeQuerySchema = instantRange(400).and(
  z.object({ deviceIds: deviceIdsParamSchema.optional() }),
);
export type EventRangeQueryInput = z.input<typeof eventRangeQuerySchema>;

/** An iOS visit (CLVisit) reported by Overland when "Visit Tracking" is on. */
export const visitSchema = z.object({
  deviceId: z.uuid(),
  recordedAt: z.iso.datetime(),
  arrivedAt: z.iso.datetime().nullable(),
  departedAt: z.iso.datetime().nullable(),
  lat: z.number(),
  lon: z.number(),
  accuracy: z.number().nullable(),
});
export type Visit = z.infer<typeof visitSchema>;

export const visitsResponseSchema = z.object({
  visits: z.array(visitSchema),
  /** One per device and local day of the range: while they all stay the same, so does the answer. */
  stamps: dayStampsSchema.optional(),
});
export type VisitsResponse = z.infer<typeof visitsResponseSchema>;
