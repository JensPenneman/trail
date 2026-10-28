import { z } from "zod";
import { cacheStampSchema } from "./cacheStamp";
import { localDateSchema } from "./datetime";
import { devicesParamSchema } from "./query";

/* Daily statistics and recent activity as the public API (v1) shows them. */

const deviceId = z.uuid().meta({
  description: "The device.",
  example: "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3",
});

/** `GET /api/v1/stats/days` — calendar days in the account's time zone, both ends included. */
export const dayStatsQuerySchema = z
  .object({
    from: localDateSchema.meta({
      description: "First day (YYYY-MM-DD, the account's time zone).",
      example: "2026-10-01",
    }),
    to: localDateSchema.meta({
      description: "Last day, included; at most 400 days after `from`.",
      example: "2026-10-26",
    }),
    devices: devicesParamSchema.optional(),
  })
  .refine((query) => query.to >= query.from, {
    message: "`to` must not be before `from`",
    path: ["to"],
  })
  .refine((query) => Date.parse(query.to) - Date.parse(query.from) <= 400 * 86_400_000, {
    message: "The range can span at most 400 days",
    path: ["to"],
  });
export type DayStatsQueryInput = z.input<typeof dayStatsQuerySchema>;

/** What one device recorded on one local day. */
export const dayStatsSchema = z
  .object({
    date: localDateSchema.meta({ description: "The local day.", example: "2026-10-26" }),
    deviceId,
    points: z.number().int().nonnegative().meta({ description: "Points recorded.", example: 1840 }),
    distanceM: z.number().nonnegative().meta({
      description:
        "Distance travelled in metres, without points less accurate than 100 m and without GPS jitter.",
      example: 23_510,
    }),
    firstAt: z.iso.datetime().meta({
      description: "The day's first point.",
      example: "2026-10-26T06:12:40.000Z",
    }),
    lastAt: z.iso.datetime().meta({
      description: "The day's last point.",
      example: "2026-10-26T21:58:03.000Z",
    }),
    stamp: cacheStampSchema.optional().meta({
      description:
        "The day's stamp, as `GET /api/v1/tracks` and `GET /api/v1/segments` carry it in their `stamps`: a copy of the day from either is current while the two are the same.",
    }),
  })
  .meta({ id: "DayStats", description: "What one device recorded on one local day." });
export type DayStats = z.infer<typeof dayStatsSchema>;

export const dayStatsResponseSchema = z.object({
  timezone: z.string().meta({
    description: "The time zone the days are in (the account's).",
    example: "Europe/Brussels",
  }),
  days: z.array(dayStatsSchema).meta({
    description: "Days with points only, by date then device.",
  }),
});
export type DayStatsResponse = z.infer<typeof dayStatsResponseSchema>;

/** `GET /api/v1/stats/activity` — hourly buckets up to the current hour. */
export const activityQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(168).default(48).meta({
    description: "How many hours back, the current one included; at most 168 (a week).",
    example: 48,
  }),
  devices: devicesParamSchema.optional(),
});
export type ActivityQueryInput = z.input<typeof activityQuerySchema>;

export const activityBucketSchema = z
  .object({
    start: z.iso.datetime().meta({
      description: "Start of the hour (UTC).",
      example: "2026-10-26T08:00:00.000Z",
    }),
    deviceId,
    recorded: z.number().int().nonnegative().meta({
      description: "Points recorded in this hour.",
      example: 212,
    }),
    uploads: z.number().int().nonnegative().meta({
      description: "Uploads Trail received from the phone in this hour.",
      example: 12,
    }),
  })
  .meta({ id: "ActivityBucket", description: "One hour of one device." });
export type ActivityBucket = z.infer<typeof activityBucketSchema>;

export const activityResponseSchema = z.object({
  from: z.iso.datetime().meta({
    description: "Start of the first hour.",
    example: "2026-10-24T09:00:00.000Z",
  }),
  to: z.iso.datetime().meta({
    description: "End of the current hour.",
    example: "2026-10-26T09:00:00.000Z",
  }),
  buckets: z.array(activityBucketSchema).meta({
    description: "Every hour × device, zeros included, by hour then device.",
  }),
});
export type ActivityResponse = z.infer<typeof activityResponseSchema>;
