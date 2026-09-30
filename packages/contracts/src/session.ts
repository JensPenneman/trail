import { z } from "zod";

/** A signed-in browser session (`GET /api/me/sessions`). */
export const sessionInfoSchema = z.object({
  id: z.string(),
  current: z.boolean(),
  /** Short human label derived from the User-Agent, e.g. "Safari on iPhone". */
  label: z.string(),
  ip: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;

export const sessionListResponseSchema = z.object({ sessions: z.array(sessionInfoSchema) });
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;
