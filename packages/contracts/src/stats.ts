import { z } from "zod";
import { localDateSchema } from "./datetime";
import { deviceIdsParamSchema } from "./query";

/** `GET /api/stats/days` — per-day totals in the user's time zone (calendar, coverage). */
export const daysQuerySchema = z
  .object({
    from: localDateSchema,
    to: localDateSchema,
    deviceIds: deviceIdsParamSchema.optional(),
  })
  .refine((q) => q.to >= q.from, { message: "`to` must not be before `from`", path: ["to"] })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 400 * 86_400_000, {
    message: "The range can span at most 400 days",
    path: ["to"],
  });
export type DaysQueryInput = z.input<typeof daysQuerySchema>;

export const dayStatSchema = z.object({
  date: localDateSchema,
  deviceId: z.uuid(),
  points: z.number().int().nonnegative(),
  distanceM: z.number().nonnegative(),
  firstAt: z.iso.datetime(),
  lastAt: z.iso.datetime(),
});
export type DayStat = z.infer<typeof dayStatSchema>;

export const daysResponseSchema = z.object({
  timezone: z.string(),
  days: z.array(dayStatSchema),
});
export type DaysResponse = z.infer<typeof daysResponseSchema>;

/** `GET /api/stats/activity` — hourly buckets over the last `hours`: the "is data still flowing" chart. */
export const activityQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(168).default(48),
  deviceIds: deviceIdsParamSchema.optional(),
});
export type ActivityQueryInput = z.input<typeof activityQuerySchema>;

export const activityBucketSchema = z.object({
  /** Start of the UTC hour. */
  start: z.iso.datetime(),
  deviceId: z.uuid(),
  /** Points whose recorded time falls in this hour. */
  recorded: z.number().int().nonnegative(),
  /** Uploads (ingest requests) received in this hour. */
  uploads: z.number().int().nonnegative(),
});
export type ActivityBucket = z.infer<typeof activityBucketSchema>;

export const activityResponseSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  buckets: z.array(activityBucketSchema),
});
export type ActivityResponse = z.infer<typeof activityResponseSchema>;
