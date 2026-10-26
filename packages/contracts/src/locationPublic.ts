import { z } from "zod";
import { batterySchema, positionSchema } from "./devicePublic";
import { instantParamSchema } from "./query";

/*
 * Recorded points as the public API (v1) shows them: spelled out here, apart
 * from the dashboard's `LocationRow`, so a dashboard change never changes v1,
 * and nothing undocumented leaves the server: no Wi-Fi network, no `extra`
 * (Overland's `device_id`, `unique_id` and whatever a later app version adds).
 */

const metres = (description: string, example: number) =>
  z.number().nullable().meta({ description, example });

/** A point as the phone recorded it (raw: no smoothing or map matching). */
export const pointSchema = positionSchema
  .extend({
    deviceId: z.uuid().meta({
      description: "The device that recorded it.",
      example: "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3",
    }),
    receivedAt: z.iso.datetime().meta({
      description: "When Trail received it (a phone sends in batches).",
      example: "2026-10-26T08:45:12.000Z",
    }),
    verticalAccuracy: metres("Vertical accuracy of the altitude in metres; null when unknown.", 3),
    speedAccuracy: metres("Accuracy of the speed in metres per second; null when unknown.", 0.5),
    courseAccuracy: metres("Accuracy of the course in degrees; null when unknown.", 12),
    battery: batterySchema.nullable(),
  })
  .meta({
    id: "Point",
    description:
      "A point the phone recorded, as it arrived: the documented fields only. What else Overland sends with a point (the Wi-Fi network, its own ids, tracking statistics) stays on the server.",
  });
export type Point = z.infer<typeof pointSchema>;

/** `GET /api/v1/locations` — one device's points in `[from, to)`, oldest first, page by page. */
export const pointsQuerySchema = z
  .object({
    device: z.uuid().meta({
      description: "The device whose points to read.",
      example: "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3",
    }),
    from: instantParamSchema.optional().meta({
      description: "Only points recorded at or after this instant.",
      example: "2026-10-26T00:00:00+01:00",
    }),
    to: instantParamSchema.optional().meta({
      description: "Only points recorded before this instant.",
      example: "2026-10-27T00:00:00+01:00",
    }),
    cursor: z.string().max(200).optional().meta({
      description: "`nextCursor` of the previous page; leave it out (or empty) for the first page.",
    }),
    limit: z.coerce.number().int().min(1).max(1000).default(100).meta({
      description: "Points per page, at most 1000.",
      example: 500,
    }),
  })
  .refine(
    (query) =>
      query.from === undefined ||
      query.to === undefined ||
      Date.parse(query.to) > Date.parse(query.from),
    { message: "`to` must be after `from`", path: ["to"] },
  );
export type PointsQueryInput = z.input<typeof pointsQuerySchema>;

export const pointPageSchema = z
  .object({
    items: z.array(pointSchema).meta({ description: "Oldest first." }),
    nextCursor: z.string().nullable().meta({
      description: "Pass it as `cursor` for the next page; null on the last page.",
      example: "MjAyNi0xMC0yNlQwODo0MTowNy4wMDBa",
    }),
  })
  .meta({ id: "PointPage", description: "A page of points." });
export type PointPage = z.infer<typeof pointPageSchema>;
