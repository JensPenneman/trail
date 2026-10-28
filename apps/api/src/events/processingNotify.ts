import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Executor } from "../db/database";

/** The Postgres channel on which a pass tells the API what it finished (docs/architecture.md §9). */
export const processingChannel = "trail_processing";

/** A pass finished a window of a device's history: the owner's streams refetch `[from, to)`. */
export interface SegmentsNotice {
  userId: string;
  deviceId: string;
  from: Date;
  to: Date;
}

const segmentsMessageSchema = z.object({
  t: z.literal("segments"),
  u: z.uuid(),
  d: z.uuid(),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
});

/** The message's text: about 160 bytes, far under the 8000 that NOTIFY carries. */
export function encodeSegmentsNotice(notice: SegmentsNotice): string {
  return JSON.stringify({
    t: "segments",
    u: notice.userId,
    d: notice.deviceId,
    from: notice.from.toISOString(),
    to: notice.to.toISOString(),
  });
}

/**
 * A message of the channel, or null when it is not one this version knows (a
 * newer release's during a deploy, or anything else sent to the channel).
 */
export function decodeSegmentsNotice(payload: string): SegmentsNotice | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  const parsed = segmentsMessageSchema.safeParse(value);
  if (!parsed.success) return null;
  const { u, d, from, to } = parsed.data;
  return { userId: u, deviceId: d, from: new Date(from), to: new Date(to) };
}

/**
 * Tells the API's listener (`processingListener.ts`) that a pass finished a
 * window. Called inside the pass's transaction: the message leaves with the
 * commit and never after a rollback, whichever process ran the pass.
 */
export async function notifySegments(tx: Executor, notice: SegmentsNotice): Promise<void> {
  await tx.execute(sql`SELECT pg_notify(${processingChannel}, ${encodeSegmentsNotice(notice)})`);
}
