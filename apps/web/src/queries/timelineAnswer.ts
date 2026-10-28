import { dayStampsSchema } from "@trail/contracts/cacheStamp";
import { segmentSchema } from "@trail/contracts/transport";
import { z } from "zod";

/**
 * What the timeline's query holds: every page of `/api/v1/segments` for the
 * range in one list, whether processing still has work in it, and the stamps
 * of its days (the first page's — every page of a range carries the same).
 */
export const timelineAnswerSchema = z.object({
  items: z.array(segmentSchema),
  pending: z.boolean(),
  stamps: dayStampsSchema.optional(),
});
export type TimelineAnswer = z.infer<typeof timelineAnswerSchema>;
