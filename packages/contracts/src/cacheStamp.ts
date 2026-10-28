import { z } from "zod";
import { localDateSchema } from "./datetime";

/*
 * Stamps tell whether a device's local day changed without asking for the day
 * again. A delta of a simplified track or of the timeline does not compose; a
 * day does: every answer sliced by local day carries a stamp per device and
 * day, the calendar's digest (`/api/stats/days`) carries the same, and equal
 * stamps mean the same answer. A stamp hashes what went into the day — with no
 * salt and no owner, so that it compares equal across restarts and routes —
 * and clients compare stamps without being able to parse them, so what goes
 * into them stays the server's to change. The fields that carry stamps are
 * optional: an answer from a server that does not stamp yet still parses.
 */

/** What a device's answers for one local day are made of. */
export const cacheStampSchema = z
  .object({
    raw: z.string().min(1).meta({
      description:
        "A hash of the day's recorded data. It changes when points, visits or trips of the day arrive — also late, for a day long past — or are deleted; a re-sent upload of duplicates changes nothing.",
      example: "GGJyqloxyuYLlVGgXnOvXX",
    }),
    processed: z.string().min(1).nullable().meta({
      description:
        "A hash of the day's processing: its averaged and mapped levels and its stops and moves. It changes when the day waits for processing and again when processing has worked it out — after new points, a corrected transport mode or a new version of the algorithms. Null while the day has no stops or moves.",
      example: "AHW_x1m7axfLciupDmb52n",
    }),
  })
  .meta({
    id: "CacheStamp",
    description:
      "A device's local day in two opaque hashes: while they stay the same, so do the day's answers. Tracks at the `raw` level, visits and trips depend on `raw`; the other levels and the timeline on both. Compare stamps and nothing more: a release may change what goes into them, which costs a copy one refetch.",
  });
export type CacheStamp = z.infer<typeof cacheStampSchema>;

/** The stamp of one device's local day, as the answers sliced by day carry it. */
export const dayStampSchema = z
  .object({
    deviceId: z.uuid().meta({
      description: "The device.",
      example: "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3",
    }),
    date: localDateSchema.meta({
      description: "The local day, in the account's time zone.",
      example: "2026-10-26",
    }),
    ...cacheStampSchema.shape,
  })
  .meta({ id: "DayStamp", description: "The stamp of one device's local day (`CacheStamp`)." });
export type DayStamp = z.infer<typeof dayStampSchema>;

/** The stamps of an answer: one per device and local day its range intersects. */
export const dayStampsSchema = z.array(dayStampSchema);
