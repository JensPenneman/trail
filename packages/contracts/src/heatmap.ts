import { z } from "zod";
import { localDateSchema } from "./datetime";
import { ordered, spanMessage, withinSpan } from "./insights";
import { deviceIdsParamSchema } from "./query";
import { transportModeSchema } from "./transport";

/** `bbox=west,south,east,north` in degrees. */
export const bboxParamSchema = z
  .string()
  .transform((value) => value.split(",").map(Number))
  .pipe(
    z.tuple([
      z.number().min(-180).max(180),
      z.number().min(-90).max(90),
      z.number().min(-180).max(180),
      z.number().min(-90).max(90),
    ]),
  );

/**
 * What a heatmap counts: recorded points, the time spent at places (stops), or the visits to them.
 * Time and visits cover a period of local days; points are all time.
 */
export const heatMeasures = ["points", "time", "visits", "moving", "speed", "topspeed"] as const;
export const heatMeasureSchema = z.enum(heatMeasures);
export type HeatMeasure = z.infer<typeof heatMeasureSchema>;

/** The measures that cover a period (`from`, `to`): every one but the points. */
export const heatPeriodMeasures: ReadonlySet<HeatMeasure> = new Set<HeatMeasure>([
  "time",
  "visits",
  "moving",
  "speed",
  "topspeed",
]);

/** The measures of the time on the move (per mode, from the per-day cells): they take a `mode`. */
export const heatMovementMeasures: ReadonlySet<HeatMeasure> = new Set<HeatMeasure>([
  "moving",
  "speed",
  "topspeed",
]);

/** The most cells one answer carries, whatever the screen: 3840 × 2160 at 11 px cells fits. */
export const heatCellCeiling = 65_536;

/** `GET /api/heatmap` — density in the viewport: points all time, or time and visits at places over a period. */
export const heatmapQuerySchema = z
  .object({
    bbox: bboxParamSchema,
    /** Current map zoom; the server picks the matching cell resolution. */
    zoom: z.coerce.number().min(0).max(24),
    deviceIds: deviceIdsParamSchema.optional(),
    heat: heatMeasureSchema.default("points"),
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    /** Only the moves in this mode (time on the move, speed, top speed); every mode when left out. */
    mode: transportModeSchema.optional(),
  })
  .refine(
    (query) =>
      heatPeriodMeasures.has(query.heat) || (query.from === undefined && query.to === undefined),
    {
      path: ["from"],
      message: "A period needs heat=time or heat=visits",
    },
  )
  .refine((query) => query.mode === undefined || heatMovementMeasures.has(query.heat), {
    path: ["mode"],
    message: "A mode needs heat=moving, speed or topspeed",
  })
  .refine(ordered, { message: "`to` must not be before `from`", path: ["to"] })
  .refine(withinSpan, { message: spanMessage, path: ["to"] });
export type HeatmapQueryInput = z.input<typeof heatmapQuerySchema>;

export const heatmapResponseSchema = z.object({
  /** What the cells count. */
  heat: heatMeasureSchema,
  /** Slippy-tile zoom of the cells (6–20): a cell is that zoom's tile. */
  cellZoom: z.number().int().min(6).max(20),
  /** `[x, y, value]`: the tile of `cellZoom` and its whole number of points, seconds or visits. */
  cells: z.array(
    z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().positive(),
    ]),
  ),
  /** The mode the cells are of (time on the move, speed, top speed); null: every mode. */
  mode: transportModeSchema.nullable().default(null),
  /** True when the viewport held more cells than the response limit. */
  truncated: z.boolean(),
  /** The local days of time and visits; null: all time (points). */
  period: z.object({ from: localDateSchema, to: localDateSchema }).nullable(),
  /** Recent days are still being worked out (time and visits); false for points. */
  pending: z.boolean(),
});
export type HeatmapResponse = z.infer<typeof heatmapResponseSchema>;
