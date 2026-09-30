import { z } from "zod";
import { deviceSummarySchema } from "./device";
import { trackPointSchema } from "./track";

/**
 * Server-sent events on `GET /api/events` (session cookie). The SSE `event:`
 * field equals `type`, `data:` is this JSON. A `: ping` comment is sent every
 * 20 s. Events are scoped to the signed-in user's devices.
 */
export const serverEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), serverTime: z.iso.datetime() }),
  /** A device was created, renamed or received data — replace it in caches. */
  z.object({ type: z.literal("device"), device: deviceSummarySchema }),
  z.object({ type: z.literal("device-removed"), deviceId: z.uuid() }),
  /** An upload was stored. `points` are the newly stored points (oldest first, at most 500). */
  z.object({
    type: z.literal("ingest"),
    deviceId: z.uuid(),
    receivedAt: z.iso.datetime(),
    inserted: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    points: z.array(trackPointSchema),
  }),
  /**
   * The session behind this stream ended — signed out, revoked from another
   * browser, expired, or the account was deleted. The server closes the stream
   * next; reconnecting would only be refused.
   */
  z.object({ type: z.literal("session-ended") }),
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;
export type ServerEventType = ServerEvent["type"];
