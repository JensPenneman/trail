import { z } from "zod";

/** Comma-separated device ids in a query string (`?deviceIds=a,b`). Omitted = all of the user's devices. */
export const deviceIdsParamSchema = z
  .string()
  .transform((value) => value.split(",").filter((part) => part.length > 0))
  .pipe(z.array(z.uuid()).min(1).max(50));

/** A time range `[from, to)` of ISO instants, at most `maxDays` long. */
export const instantRange = (maxDays: number) =>
  z
    .object({ from: z.iso.datetime(), to: z.iso.datetime() })
    .refine((range) => Date.parse(range.to) > Date.parse(range.from), {
      message: "`to` must be after `from`",
      path: ["to"],
    })
    .refine((range) => Date.parse(range.to) - Date.parse(range.from) <= maxDays * 86_400_000, {
      message: `The range can span at most ${maxDays} days`,
      path: ["to"],
    });

/*
 * Public API (v1) query parameters. Instants take any offset (`…Z`,
 * `…+02:00`); a device list is called `devices` there.
 */

/** v1: an ISO 8601 instant with its offset, e.g. `2026-10-26T09:41:07+02:00`. */
export const instantParamSchema = z.iso.datetime({ offset: true });

/** v1: `devices=<id>,<id>` — omitted means every device the credential reaches. */
export const devicesParamSchema = deviceIdsParamSchema.meta({
  description:
    "Comma-separated device ids, at most 50. Leave it out for every device the token (or session) reaches.",
  example: "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3,0199a0f4-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
});

/** v1: `[from, to)` of instants, at most 400 days, and optionally some devices (visits, trips). */
export const historyRangeQuerySchema = z
  .object({
    from: instantParamSchema.meta({
      description: "Start of the range (included).",
      example: "2026-10-25T00:00:00+02:00",
    }),
    to: instantParamSchema.meta({
      description: "End of the range (excluded); at most 400 days after `from`.",
      example: "2026-10-26T00:00:00+01:00",
    }),
    devices: devicesParamSchema.optional(),
  })
  .refine((range) => Date.parse(range.to) > Date.parse(range.from), {
    message: "`to` must be after `from`",
    path: ["to"],
  })
  .refine((range) => Date.parse(range.to) - Date.parse(range.from) <= 400 * 86_400_000, {
    message: "The range can span at most 400 days",
    path: ["to"],
  });
export type HistoryRangeQueryInput = z.input<typeof historyRangeQuerySchema>;
