import { z } from "zod";

/* Visits as the public API (v1) shows them, apart from the dashboard's contract. */

const nullableInstant = (description: string, example: string) =>
  z.iso.datetime().nullable().meta({ description, example });

/** A place where iOS saw the phone stay (CLVisit), reported by Overland with "Visit Tracking" on. */
export const visitPublicSchema = z
  .object({
    deviceId: z.uuid().meta({
      description: "The device that reported it.",
      example: "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3",
    }),
    recordedAt: z.iso.datetime().meta({
      description: "When the phone reported the visit.",
      example: "2026-10-26T12:31:02.000Z",
    }),
    arrivedAt: nullableInstant(
      "Arrival; null when iOS did not know it.",
      "2026-10-26T08:58:40.000Z",
    ),
    departedAt: nullableInstant(
      "Departure; null while the visit is still going on (or when iOS did not know it).",
      "2026-10-26T12:30:11.000Z",
    ),
    lat: z.number().meta({ description: "Latitude of the place (WGS84).", example: 51.0543 }),
    lon: z.number().meta({ description: "Longitude of the place (WGS84).", example: 3.7174 }),
    accuracy: z.number().nullable().meta({
      description: "Horizontal accuracy in metres; null when unknown.",
      example: 35,
    }),
  })
  .meta({
    id: "Visit",
    description:
      "A stay at one place. iOS reports a visit on arrival and again on departure; the two reports come as one visit.",
  });
export type VisitPublic = z.infer<typeof visitPublicSchema>;

/** `GET /api/v1/visits` */
export const visitsPublicResponseSchema = z.object({
  visits: z.array(visitPublicSchema).meta({ description: "By arrival, oldest first." }),
});
export type VisitsPublicResponse = z.infer<typeof visitsPublicResponseSchema>;
