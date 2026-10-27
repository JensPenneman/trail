import { z } from "zod";
import { localDateSchema } from "./datetime";
import { devicesParamSchema } from "./query";
import { transportModeSchema, wayKinds } from "./transport";

/*
 * Insights (docs/architecture.md §8.7): statistics of how the account's owner
 * travelled, worked out from the stops and moves of the timeline over local
 * days in the account's time zone. No coordinates anywhere: `history:read`.
 */

/** A request covers at most this many years. */
export const insightsMaxYears = 3;

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * The last local day a period that starts on `from` may end on: the day before
 * the same date `insightsMaxYears` later (29 February moves to 1 March).
 */
export function lastInsightsDay(from: string): string {
  const [year = 0, month = 1, day = 1] = from.split("-").map(Number);
  const end = new Date(Date.UTC(year + insightsMaxYears, month - 1, day - 1));
  return `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`;
}

const spanMessage = `The period can span at most ${insightsMaxYears} years`;

const deviceId = z.uuid().meta({
  description: "The device.",
  example: "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3",
});

const queryShape = {
  from: localDateSchema.optional().meta({
    description:
      "First local day (the account's time zone). Left out: the first day with stops or moves, at most three years before `to`.",
    example: "2026-09-28",
  }),
  to: localDateSchema.optional().meta({
    description: "Last local day, included. Left out: today. At most three years after `from`.",
    example: "2026-10-27",
  }),
  devices: devicesParamSchema.optional(),
};

interface PeriodQuery {
  from?: string | undefined;
  to?: string | undefined;
}

const ordered = (query: PeriodQuery): boolean =>
  query.from === undefined || query.to === undefined || query.to >= query.from;
const withinSpan = (query: PeriodQuery): boolean =>
  query.from === undefined || query.to === undefined || query.to <= lastInsightsDay(query.from);

/** `GET /api/v1/insights/overview` and `GET /api/v1/insights/modes/{mode}` */
export const insightsQuerySchema = z
  .object(queryShape)
  .refine(ordered, { message: "`to` must not be before `from`", path: ["to"] })
  .refine(withinSpan, { message: spanMessage, path: ["to"] });
export type InsightsQueryInput = z.input<typeof insightsQuerySchema>;

/** `GET /api/v1/insights/time` and `GET /api/v1/insights/roads`: one mode, or every one. */
export const insightsModeFilterQuerySchema = z
  .object({
    ...queryShape,
    mode: transportModeSchema.optional().meta({
      description: "Only the moves in this mode; every move when left out.",
      example: "cycling",
    }),
  })
  .refine(ordered, { message: "`to` must not be before `from`", path: ["to"] })
  .refine(withinSpan, { message: spanMessage, path: ["to"] });
export type InsightsModeFilterQueryInput = z.input<typeof insightsModeFilterQuerySchema>;

/** Path parameters of `GET /api/v1/insights/modes/{mode}`. */
export const insightsModeParamsSchema = z.object({ mode: transportModeSchema });

/** How the period is cut for a series: by span, ≤ 31 days by day, ≤ 26 weeks by week, else by month. */
export const insightsBuckets = ["day", "week", "month"] as const;
export const insightsBucketSchema = z.enum(insightsBuckets).meta({
  id: "InsightsBucket",
  description:
    "The steps of a series: `day` for periods of up to 31 days, `week` (Monday to Sunday) up to 26 weeks, else `month`.",
  example: "week",
});
export type InsightsBucket = z.infer<typeof insightsBucketSchema>;

const distanceM = (description: string, example: number) =>
  z.number().nonnegative().meta({ description, example });
const durationS = (description: string, example: number) =>
  z.number().int().nonnegative().meta({ description, example });
const share = (description: string, example: number) =>
  z.number().min(0).max(1).meta({ description, example });

export const insightsPeriodSchema = z
  .object({
    from: localDateSchema.meta({ description: "First local day.", example: "2026-09-28" }),
    to: localDateSchema.meta({ description: "Last local day, included.", example: "2026-10-27" }),
    days: z.number().int().positive().meta({ description: "Days in the period.", example: 30 }),
  })
  .meta({ id: "InsightsPeriod", description: "The local days the numbers cover." });
export type InsightsPeriod = z.infer<typeof insightsPeriodSchema>;

/** A period with the steps of its series. */
export const insightsSeriesPeriodSchema = insightsPeriodSchema
  .extend({
    bucket: insightsBucketSchema,
    buckets: z.array(localDateSchema).meta({
      description:
        "Every step of the series in order, by its first day (a week by its Monday, which may lie before `from`).",
      example: ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"],
    }),
  })
  .meta({ id: "InsightsSeriesPeriod", description: "The local days covered, and their steps." });
export type InsightsSeriesPeriod = z.infer<typeof insightsSeriesPeriodSchema>;

export const insightsTotalsSchema = z
  .object({
    distanceM: distanceM("Distance moved in metres.", 412_380),
    durationS: durationS("Time on the move in seconds.", 61_920),
    moves: z
      .number()
      .int()
      .nonnegative()
      .meta({ description: "Moves that started in the period.", example: 96 }),
    stops: z
      .number()
      .int()
      .nonnegative()
      .meta({ description: "Stops that started in the period.", example: 88 }),
    activeDays: z
      .number()
      .int()
      .nonnegative()
      .meta({ description: "Days with any time on the move.", example: 27 }),
  })
  .meta({
    id: "InsightsTotals",
    description:
      "Totals of a period. A move across the period's edge counts with the part inside it; counts are of what started inside.",
  });
export type InsightsTotals = z.infer<typeof insightsTotalsSchema>;

export const insightsModeShareSchema = z
  .object({
    mode: transportModeSchema,
    distanceM: distanceM("Distance in this mode, metres.", 183_400),
    durationS: durationS("Time in this mode, seconds.", 7260),
    moves: z
      .number()
      .int()
      .nonnegative()
      .meta({ description: "Moves in this mode that started in the period.", example: 12 }),
    avgSpeedKmh: z
      .number()
      .nonnegative()
      .meta({ description: "Distance over time, km/h.", example: 90.9 }),
    share: share("This mode's part of the distance moved, 0 to 1.", 0.445),
    deltaDistanceM: z.number().meta({
      description: "Distance compared with the previous period, metres (negative: less).",
      example: 21_500,
    }),
  })
  .meta({ id: "InsightsModeShare", description: "One transport mode's part of a period." });
export type InsightsModeShare = z.infer<typeof insightsModeShareSchema>;

export const insightsSeriesEntrySchema = z
  .object({
    bucket: localDateSchema.meta({
      description: "The step's first day (see `period.buckets`).",
      example: "2026-10-19",
    }),
    mode: transportModeSchema,
    distanceM: distanceM("Metres.", 61_200),
    durationS: durationS("Seconds.", 2880),
  })
  .meta({ id: "InsightsSeriesEntry", description: "Distance and time of one mode in one step." });
export type InsightsSeriesEntry = z.infer<typeof insightsSeriesEntrySchema>;

const pendingSchema = z.boolean().meta({
  description:
    "Recorded points of the period still wait for processing: the numbers may still change.",
  example: false,
});

const timezoneSchema = z.string().meta({
  description: "The account's time zone, which the days follow.",
  example: "Europe/Brussels",
});

/** `GET /api/v1/insights/overview` */
export const insightsOverviewSchema = z
  .object({
    timezone: timezoneSchema,
    period: insightsSeriesPeriodSchema,
    previous: insightsPeriodSchema
      .extend({ totals: insightsTotalsSchema })
      .meta({ description: "The period of as many days just before, for comparison." }),
    totals: insightsTotalsSchema,
    modes: z.array(insightsModeShareSchema).meta({
      description: "The modes moved in, most distance first.",
    }),
    series: z.array(insightsSeriesEntrySchema).meta({
      description:
        "Distance and time per step and mode, by step and then in the order of the modes; steps and modes without time are left out.",
    }),
    pending: pendingSchema,
  })
  .meta({ id: "InsightsOverview", description: "How you travelled in a period." });
export type InsightsOverview = z.infer<typeof insightsOverviewSchema>;

export const insightsMoveSchema = z
  .object({
    segmentId: z.uuid().meta({
      description: "The move in the timeline (`GET /api/v1/segments`).",
      example: "019a1f7e-3c55-7b42-9d0e-5b7f3a1c2d4e",
    }),
    deviceId,
    startedAt: z.iso
      .datetime()
      .meta({ description: "Start.", example: "2026-10-21T06:42:10.000Z" }),
    endedAt: z.iso.datetime().meta({ description: "End.", example: "2026-10-21T07:20:40.000Z" }),
    distanceM: distanceM("Metres.", 31_240),
    durationS: durationS("Seconds.", 2310),
    avgSpeedKmh: z
      .number()
      .nonnegative()
      .meta({ description: "Distance over time, km/h.", example: 48.7 }),
    maxSpeedKmh: z.number().nonnegative().meta({
      description: "Top speed, km/h (outliers left out).",
      example: 121.3,
    }),
  })
  .meta({ id: "InsightsMove", description: "One move, without where it went." });
export type InsightsMove = z.infer<typeof insightsMoveSchema>;

const hourSchema = z
  .object({
    hour: z
      .number()
      .int()
      .min(0)
      .max(23)
      .meta({ description: "Hour of the day, 0 to 23.", example: 8 }),
    distanceM: distanceM("Metres.", 12_400),
    durationS: durationS("Seconds.", 1500),
  })
  .meta({ id: "InsightsHour", description: "Distance and time in one hour of the day." });

const weekdaySchema = z
  .object({
    weekday: z.number().int().min(1).max(7).meta({
      description: "Day of the week, 1 (Monday) to 7 (Sunday).",
      example: 1,
    }),
    distanceM: distanceM("Metres.", 24_300),
    durationS: durationS("Seconds.", 3120),
  })
  .meta({ id: "InsightsWeekday", description: "Distance and time on one day of the week." });

export const wayKindSchema = z.enum(wayKinds).meta({
  id: "WayKind",
  description:
    "A class of road or railway from OpenStreetMap: the road classes `motorway` to `path`, the railways `rail`, `light_rail`, `tram` and `subway`, `ferry` routes, and `other` for travel off every mapped way.",
  example: "primary",
});

export const insightsWayKindSchema = z
  .object({
    kind: wayKindSchema,
    distanceM: distanceM("Metres on this kind of way.", 18_250),
    share: share("Its part of the distance with map data, 0 to 1.", 0.311),
  })
  .meta({ id: "InsightsWayKind", description: "Distance on one kind of way." });
export type InsightsWayKind = z.infer<typeof insightsWayKindSchema>;

/** The kinds of way as the inference groups them (the families of `features.ways`). */
export const wayFamilies = [
  "motorway",
  "road",
  "cycleway",
  "foot",
  "rail",
  "tram",
  "subway",
  "ferry",
  "none",
] as const;
export const wayFamilySchema = z.enum(wayFamilies).meta({
  id: "WayFamily",
  description:
    "Kinds of way grouped: `motorway` (motorways and trunk roads), `road` (primary to track), `cycleway`, `foot` (footways and paths), `rail`, `tram` (tram and light rail), `subway`, `ferry`, `none` (off every mapped way).",
  example: "road",
});
export type WayFamily = z.infer<typeof wayFamilySchema>;

export const insightsWayFamilySchema = z
  .object({
    family: wayFamilySchema,
    distanceM: distanceM("Metres on this family of ways.", 26_900),
    share: share("Its part of the distance with map data, 0 to 1.", 0.458),
  })
  .meta({ id: "InsightsWayFamily", description: "Distance on one family of ways." });
export type InsightsWayFamily = z.infer<typeof insightsWayFamilySchema>;

const roadsSchema = z
  .object({
    distanceM: distanceM("Distance of the moves counted, metres.", 61_700),
    mappedM: distanceM(
      "The part of it with map data (moves processed with map matching), metres.",
      58_640,
    ),
    kinds: z.array(insightsWayKindSchema).meta({
      description:
        "The kinds of way travelled on, in the order of `WayKind`; none without map data.",
    }),
  })
  .meta({ id: "InsightsModeRoads", description: "Distance by kind of way." });

const onWaySchema = (description: string) =>
  z
    .object({
      distanceM: distanceM("Metres.", 29_870),
      share: share("Part of the distance with map data, 0 to 1.", 0.962),
    })
    .nullable()
    .meta({ description });

const histogramSchema = z
  .object({
    binKmh: z.number().positive().meta({ description: "Width of every bin, km/h.", example: 10 }),
    bins: z
      .array(
        z.object({
          fromKmh: z.number().nonnegative().meta({ description: "From, km/h.", example: 40 }),
          toKmh: z.number().positive().meta({ description: "Up to, km/h.", example: 50 }),
          moves: z.number().int().nonnegative().meta({ description: "Moves.", example: 4 }),
        }),
      )
      .meta({ description: "From 0 up to the fastest move's bin, empty bins included." }),
  })
  .meta({
    id: "InsightsSpeedHistogram",
    description: "The moves by their median speed (how fast they mostly went).",
  });

/** `GET /api/v1/insights/modes/{mode}` */
export const insightsModeSchema = z
  .object({
    timezone: timezoneSchema,
    mode: transportModeSchema,
    period: insightsSeriesPeriodSchema,
    totals: z
      .object({
        distanceM: distanceM("Metres.", 183_400),
        durationS: durationS("Seconds.", 7260),
        moves: z
          .number()
          .int()
          .nonnegative()
          .meta({ description: "Moves that started in the period.", example: 12 }),
        avgSpeedKmh: z
          .number()
          .nonnegative()
          .meta({ description: "Distance over time, km/h.", example: 90.9 }),
        typicalSpeedKmh: z.number().nonnegative().nullable().meta({
          description:
            "The moves' median speeds, their median weighted by time: how fast you usually go. Null without moves.",
          example: 96.4,
        }),
        longest: insightsMoveSchema.nullable().meta({ description: "The longest move." }),
        fastest: insightsMoveSchema
          .nullable()
          .meta({ description: "The move with the highest top speed." }),
      })
      .meta({ id: "InsightsModeTotals", description: "Totals of one mode in the period." }),
    series: z
      .array(
        z.object({
          bucket: localDateSchema.meta({
            description: "The step's first day.",
            example: "2026-10-19",
          }),
          distanceM: distanceM("Metres.", 61_200),
          durationS: durationS("Seconds.", 2880),
        }),
      )
      .meta({ description: "Distance and time per step, every step of `period.buckets`." }),
    byHour: z.array(hourSchema).meta({ description: "The 24 hours of the day, from 0." }),
    byWeekday: z.array(weekdaySchema).meta({ description: "The 7 days of the week, from Monday." }),
    roads: roadsSchema,
    rail: onWaySchema(
      "Train, tram and metro: the distance on railway tracks (rail, light rail, tram and subway). Null for other modes.",
    ),
    ferry: onWaySchema("Boat: the distance on ferry routes. Null for other modes."),
    stationStops: z.number().int().nonnegative().nullable().meta({
      description:
        "Train, tram and metro: how often the moves halted at a station (a tram stop, a metro station) along the way. Null for other modes.",
      example: 14,
    }),
    speedHistogram: histogramSchema,
    topMoves: z
      .object({
        longest: z.array(insightsMoveSchema).meta({ description: "The five longest." }),
        fastest: z
          .array(insightsMoveSchema)
          .meta({ description: "The five with the highest top speed." }),
        recent: z.array(insightsMoveSchema).meta({ description: "The five most recent." }),
      })
      .meta({ id: "InsightsTopMoves", description: "Moves of the period worth a look." }),
    pending: pendingSchema,
  })
  .meta({ id: "InsightsMode", description: "How you travelled in one mode." });
export type InsightsMode = z.infer<typeof insightsModeSchema>;

const modesPresentSchema = z.array(transportModeSchema).meta({
  description:
    "The modes moved in during the period (whatever `mode` asks for), in the order of `TransportMode`.",
  example: ["walking", "cycling", "train"],
});

/** `GET /api/v1/insights/time` */
export const insightsTimeSchema = z
  .object({
    timezone: timezoneSchema,
    period: insightsPeriodSchema,
    mode: transportModeSchema
      .nullable()
      .meta({ description: "The mode asked for; null: every mode." }),
    modes: modesPresentSchema,
    cells: z
      .array(
        z.object({
          weekday: z.number().int().min(1).max(7).meta({
            description: "Day of the week, 1 (Monday) to 7 (Sunday).",
            example: 1,
          }),
          hour: z.number().int().min(0).max(23).meta({ description: "Hour, 0 to 23.", example: 8 }),
          distanceM: distanceM("Metres.", 9800),
          durationS: durationS("Seconds.", 1260),
        }),
      )
      .meta({ description: "Every hour of every day of the week: 168 cells, Monday 0:00 first." }),
    pending: pendingSchema,
  })
  .meta({
    id: "InsightsTime",
    description: "When you travel: time and distance per weekday and hour.",
  });
export type InsightsTime = z.infer<typeof insightsTimeSchema>;

/** `GET /api/v1/insights/roads` */
export const insightsRoadsSchema = z
  .object({
    timezone: timezoneSchema,
    period: insightsPeriodSchema,
    mode: transportModeSchema
      .nullable()
      .meta({ description: "The mode asked for; null: every mode." }),
    modes: modesPresentSchema,
    distanceM: distanceM("Distance of the moves counted, metres.", 412_380),
    mappedM: distanceM("The part of it with map data, metres.", 377_910),
    kinds: z.array(insightsWayKindSchema).meta({
      description: "Distance by kind of way, in the order of `WayKind`.",
    }),
    families: z.array(insightsWayFamilySchema).meta({
      description: "The same by family, in the order of `WayFamily`.",
    }),
    pending: pendingSchema,
  })
  .meta({ id: "InsightsRoads", description: "The roads and railways you travelled on." });
export type InsightsRoads = z.infer<typeof insightsRoadsSchema>;
