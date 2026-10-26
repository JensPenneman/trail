import { z } from "zod";

/* Trips as the public API (v1) shows them, apart from the dashboard's contract. */

/** A trip recorded with Overland's Start and Stop button. */
export const tripPublicSchema = z
  .object({
    deviceId: z.uuid().meta({
      description: "The device that recorded it.",
      example: "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3",
    }),
    startedAt: z.iso.datetime().meta({
      description: "When the trip started.",
      example: "2026-10-26T07:02:10.000Z",
    }),
    endedAt: z.iso.datetime().meta({
      description: "When it ended.",
      example: "2026-10-26T07:41:55.000Z",
    }),
    mode: z.string().meta({
      description: "The mode chosen in Overland: `walk`, `run`, `bicycle`, `car`, `train` …",
      example: "bicycle",
    }),
    distanceM: z
      .number()
      .nonnegative()
      .meta({ description: "Distance in metres.", example: 12_480 }),
    durationS: z
      .number()
      .nonnegative()
      .meta({ description: "Duration in seconds.", example: 2385 }),
    steps: z.number().int().nonnegative().nullable().meta({
      description: "Steps counted on the way; null when the phone did not count them.",
      example: null,
    }),
    stoppedAutomatically: z.boolean().meta({
      description: "Whether Overland ended it by itself rather than with the Stop button.",
      example: false,
    }),
  })
  .meta({ id: "Trip", description: "A trip recorded with Overland's Start and Stop button." });
export type TripPublic = z.infer<typeof tripPublicSchema>;

/** `GET /api/v1/trips` */
export const tripsPublicResponseSchema = z.object({
  trips: z.array(tripPublicSchema).meta({ description: "By start, oldest first." }),
});
export type TripsPublicResponse = z.infer<typeof tripsPublicResponseSchema>;
