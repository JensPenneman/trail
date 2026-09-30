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
