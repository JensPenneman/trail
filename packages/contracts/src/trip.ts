import { z } from "zod";

/** A trip recorded with Overland's Start/Stop button (`GET /api/trips`, query = `eventRangeQuerySchema`). */
export const tripSchema = z.object({
  deviceId: z.uuid(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  /** Overland trip mode: walk, run, bicycle, car, train, plane, … */
  mode: z.string(),
  distanceM: z.number().nonnegative(),
  durationS: z.number().nonnegative(),
  steps: z.number().int().nonnegative().nullable(),
  stoppedAutomatically: z.boolean(),
});
export type Trip = z.infer<typeof tripSchema>;

export const tripsResponseSchema = z.object({ trips: z.array(tripSchema) });
export type TripsResponse = z.infer<typeof tripsResponseSchema>;
