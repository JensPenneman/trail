import { z } from "zod";
import { deviceAppSchema } from "./deviceApp";

/** One accepted upload (`GET /api/devices/:id/ingest-log`) — the audit trail that data arrives. */
export const ingestLogEntrySchema = z.object({
  id: z.string(),
  receivedAt: z.iso.datetime(),
  /** The app the device was set up for when the upload came in: it decided how Trail read it. */
  source: deviceAppSchema,
  /** Records in the upload: entries of Overland's `locations` array, one message for the other apps. */
  records: z.number().int().nonnegative(),
  /** Newly stored location points. */
  locations: z.number().int().nonnegative(),
  /** Points already stored before (phones send again what they saw no answer for). */
  duplicates: z.number().int().nonnegative(),
  visits: z.number().int().nonnegative(),
  trips: z.number().int().nonnegative(),
  events: z.number().int().nonnegative(),
  /** Invalid records, kept in the dead-letter table. */
  rejected: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  userAgent: z.string().nullable(),
});
export type IngestLogEntry = z.infer<typeof ingestLogEntrySchema>;

export const ingestLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const ingestLogResponseSchema = z.object({ entries: z.array(ingestLogEntrySchema) });
export type IngestLogResponse = z.infer<typeof ingestLogResponseSchema>;
