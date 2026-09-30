import { z } from "zod";
import { deviceIdsParamSchema, instantRange } from "./query";

/**
 * A compact track point: `[lon, lat, t, speed, accuracy, altitude]`
 * — `t` in epoch seconds; speed m/s, accuracy m, altitude m (null when unknown).
 */
export const trackPointSchema = z.tuple([
  z.number(),
  z.number(),
  z.number().int(),
  z.number().nullable(),
  z.number().nullable(),
  z.number().nullable(),
]);
export type TrackPoint = z.infer<typeof trackPointSchema>;

/** `GET /api/tracks` — points of each device in `[from, to)`, simplified to at most `maxPoints` per device. */
export const tracksQuerySchema = instantRange(93).and(
  z.object({
    deviceIds: deviceIdsParamSchema.optional(),
    maxPoints: z.coerce.number().int().min(100).max(50_000).default(8_000),
    /** Points with a worse horizontal accuracy (metres) are left out. */
    maxAccuracy: z.coerce.number().int().min(5).max(5_000).default(200),
  }),
);
export type TracksQueryInput = z.input<typeof tracksQuerySchema>;

export const trackSchema = z.object({
  deviceId: z.uuid(),
  /** Points in range that passed the accuracy filter, before simplification. */
  total: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  simplified: z.boolean(),
  /** Jitter-suppressed distance over the unsimplified points. */
  distanceM: z.number().nonnegative(),
  firstAt: z.iso.datetime().nullable(),
  lastAt: z.iso.datetime().nullable(),
  points: z.array(trackPointSchema),
});
export type Track = z.infer<typeof trackSchema>;

export const tracksResponseSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  tracks: z.array(trackSchema),
});
export type TracksResponse = z.infer<typeof tracksResponseSchema>;
