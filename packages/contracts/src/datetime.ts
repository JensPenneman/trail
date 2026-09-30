import { z } from "zod";

/** An instant as an ISO 8601 UTC string, e.g. `2026-09-30T19:41:07.000Z` (what `Date#toISOString` returns). */
export const isoDateTimeSchema = z.iso.datetime();

/** A calendar date `YYYY-MM-DD`, interpreted in the user's time zone. */
export const localDateSchema = z.iso.date();

/** An IANA time zone name that the runtime knows, e.g. `Europe/Brussels`. */
export const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone");
