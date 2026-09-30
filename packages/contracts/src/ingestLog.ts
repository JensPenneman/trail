import { z } from "zod";

/** One accepted Overland request (`GET /api/devices/:id/ingest-log`) — the audit trail that data arrives. */
export const ingestLogEntrySchema = z.object({
  id: z.string(),
  receivedAt: z.iso.datetime(),
  /** Records in the payload's `locations` array. */
  records: z.number().int().nonnegative(),
  /** Newly stored location points. */
  locations: z.number().int().nonnegative(),
  /** Records already stored before (Overland re-sends a batch it never got an ack for). */
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
