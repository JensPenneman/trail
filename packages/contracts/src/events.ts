import { z } from "zod";
import { deviceSummarySchema } from "./device";
import { sharedDeviceSchema } from "./person";
import { trackPointSchema } from "./track";

/** What happened to a share, as told to the other side of it (docs/architecture.md §9). */
export const shareChanges = [
  /** To the recipient: someone started sharing with you. */
  "created",
  /** To the recipient: the owner changed what or how long they share. */
  "updated",
  /** To the recipient: the owner stopped sharing (or deleted the device or the account). */
  "revoked",
  /** To the owner: the recipient hid them. */
  "hidden",
  /** To the owner: the recipient shows them again. */
  "unhidden",
  /**
   * To the owner: someone signed up with the address of a pending share. With
   * an invitation to that address it is active now; otherwise it waits for the
   * owner's confirmation (`joined`).
   */
  "claimed",
] as const;
export type ShareChange = (typeof shareChanges)[number];

/**
 * Server-sent events on `GET /api/events` (session cookie). The SSE `event:`
 * field equals `type`, `data:` is this JSON. A `: ping` comment is sent every
 * 20 s. Events are scoped to the signed-in user's devices and to what other
 * people share with them, projected as their shares allow.
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
  /** A device someone shares with you reported a position (already at the share's precision). */
  z.object({ type: z.literal("person"), userId: z.uuid(), device: sharedDeviceSchema }),
  /**
   * A share with you, or one of yours, changed: refetch people and shares.
   * `userId` is the other side (the owner or the recipient), null while unknown.
   */
  z.object({
    type: z.literal("share"),
    shareId: z.uuid(),
    userId: z.uuid().nullable(),
    change: z.enum(shareChanges),
  }),
  /**
   * Processing finished a window of a device's history: its stops, moves and
   * the averaged and mapped levels of `[from, to)` changed. Refetch that range.
   */
  z.object({
    type: z.literal("segments"),
    deviceId: z.uuid(),
    from: z.iso.datetime(),
    to: z.iso.datetime(),
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
