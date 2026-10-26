import { z } from "zod";
import { emailSchema } from "./email";

/*
 * Sharing with people (docs/architecture.md §8.4): one person shows another
 * where they are, one way and on purpose, for as long as they choose. The
 * owner manages outgoing shares; the recipient sees incoming ones and may
 * hide a person.
 */

/** How exactly a share shows where its owner is. */
export const sharePrecisions = ["precise", "approximate", "area"] as const;

export const sharePrecisionSchema = z.enum(sharePrecisions).meta({
  id: "SharePrecision",
  description:
    "`precise`: the position as recorded. `approximate`: the centre of a cell about 560 m across (a neighbourhood). `area`: a cell about 5.6 km across (a town or a part of a city). The cells are fixed per share, so repeated reads always give the same answer and cannot be averaged back to the real position.",
  example: "approximate",
});
export type SharePrecision = z.infer<typeof sharePrecisionSchema>;

/** How long a share runs, counted from the moment it is created or changed (Find My's choices). */
export const shareDurations = ["hour", "endOfDay", "week", "indefinitely"] as const;

export const shareDurationSchema = z.enum(shareDurations).meta({
  id: "ShareDuration",
  description:
    "`hour`: one hour. `endOfDay`: until midnight in the owner's time zone. `week`: seven days. `indefinitely`: until it is stopped.",
  example: "endOfDay",
});
export type ShareDuration = z.infer<typeof shareDurationSchema>;

/** The longest history a share with a person may include. */
export const maxShareHistoryDays = 365;

/** Only precise shares carry history: a coarse position over time would narrow it down again. */
export const historyNeedsPrecise =
  "History needs precise sharing: approximate and area shares are live only.";

const shareId = z.uuid().meta({
  description: "The share's id.",
  example: "019a2b4c-7d10-7e3a-9b21-5c8d0e6f1a23",
});

const instant = (description: string) =>
  z.iso.datetime().meta({ description, example: "2026-10-26T08:41:07.000Z" });

const optionalInstant = (description: string) =>
  z.iso.datetime().nullable().meta({ description, example: "2026-10-26T22:59:59.000Z" });

/** Device ids of the owner; null = every device, also the ones added later. */
export const shareDeviceIdsSchema = z.array(z.uuid()).min(1).max(50).nullable().meta({
  description:
    "The devices shared: ids of the owner's devices, or null for all of them, also the ones added later.",
  example: null,
});

export const shareHistoryDaysSchema = z
  .number()
  .int()
  .min(1)
  .max(maxShareHistoryDays)
  .nullable()
  .meta({
    description:
      "How many days of past positions the recipient may see; null for live only (the newest position). Only with `precise`.",
    example: null,
  });

const includeDetails = z.boolean().meta({
  description: "Whether battery and activity (motion, trip, transport mode) are shared too.",
  example: true,
});

/** A share the caller gives: who sees what, and until when. */
export const outgoingShareSchema = z
  .object({
    id: shareId,
    recipient: z
      .object({
        email: z.email().meta({
          description: "The address shared with (lower-case).",
          example: "ana@example.com",
        }),
        userId: z.uuid().nullable().meta({
          description: "The recipient's account; null while the address has no account.",
          example: "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a60",
        }),
        displayName: z.string().nullable().meta({
          description: "The recipient's name in Trail; null while the address has no account.",
          example: "Ana",
        }),
      })
      .meta({ description: "Who sees the location." }),
    status: z.enum(["pending", "active", "hidden"]).meta({
      description:
        "`pending`: the address has no account yet; the share starts when someone signs up with it. `active`: the recipient sees the location. `hidden`: the recipient has hidden this person; nothing is sent to them until they show the person again.",
      example: "active",
    }),
    deviceIds: shareDeviceIdsSchema,
    precision: sharePrecisionSchema,
    historyDays: shareHistoryDaysSchema,
    includeDetails,
    expiresAt: optionalInstant("When the share ends by itself; null when it runs until stopped."),
    createdAt: instant("When the share started."),
    lastViewedAt: optionalInstant(
      "When the recipient last looked at the location (to the minute); null if never.",
    ),
  })
  .meta({ id: "OutgoingShare", description: "Your location, shared with one person." });
export type OutgoingShare = z.infer<typeof outgoingShareSchema>;

/** A share someone gives the caller. */
export const incomingShareSchema = z
  .object({
    id: shareId,
    owner: z
      .object({
        userId: z.uuid().meta({
          description: "The account that shares.",
          example: "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a60",
        }),
        displayName: z.string().meta({ description: "Their name in Trail.", example: "Jens" }),
        email: z.email().meta({ description: "Their address.", example: "jens@example.com" }),
      })
      .meta({ description: "Who shares." }),
    precision: sharePrecisionSchema,
    historyDays: shareHistoryDaysSchema,
    includeDetails,
    expiresAt: optionalInstant("When the share ends by itself; null when it runs until stopped."),
    createdAt: instant("When the share started."),
    hiddenAt: optionalInstant("When you hid this person; null while they are shown."),
  })
  .meta({ id: "IncomingShare", description: "Someone's location, shared with you." });
export type IncomingShare = z.infer<typeof incomingShareSchema>;

/** Path parameters of `/api/v1/shares/{id}…`. */
export const shareParamsSchema = z.object({ id: shareId });

/** `GET /api/v1/shares` */
export const shareListResponseSchema = z.object({
  shares: z
    .array(outgoingShareSchema)
    .meta({ description: "Current shares (not stopped, not ended), newest first." }),
});
export type ShareListResponse = z.infer<typeof shareListResponseSchema>;

/** `POST /api/v1/shares` (201), `PATCH /api/v1/shares/{id}` */
export const shareResponseSchema = z.object({ share: outgoingShareSchema });
export type ShareResponse = z.infer<typeof shareResponseSchema>;

const requiresPreciseForHistory = (body: {
  precision?: SharePrecision | undefined;
  historyDays?: number | null | undefined;
}) =>
  body.historyDays === undefined ||
  body.historyDays === null ||
  body.precision === undefined ||
  body.precision === "precise";

/** `POST /api/v1/shares` */
export const createShareRequestSchema = z
  .object({
    email: emailSchema.meta({
      description: "The person's address. Without an account yet, the share waits for them.",
      example: "ana@example.com",
    }),
    deviceIds: shareDeviceIdsSchema.optional(),
    precision: sharePrecisionSchema,
    historyDays: shareHistoryDaysSchema.optional(),
    includeDetails: includeDetails.optional(),
    duration: shareDurationSchema,
  })
  .refine(requiresPreciseForHistory, { message: historyNeedsPrecise, path: ["historyDays"] })
  .meta({ id: "CreateShareRequest", description: "Start sharing your location with a person." });
export type CreateShareRequest = z.input<typeof createShareRequestSchema>;

/** `PATCH /api/v1/shares/{id}` */
export const updateShareRequestSchema = z
  .object({
    duration: shareDurationSchema
      .optional()
      .meta({ description: "A new duration, counted from now: extends or shortens the share." }),
    deviceIds: shareDeviceIdsSchema.optional(),
    precision: sharePrecisionSchema.optional(),
    historyDays: shareHistoryDaysSchema.optional(),
    includeDetails: includeDetails.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "Nothing to update")
  .refine(requiresPreciseForHistory, { message: historyNeedsPrecise, path: ["historyDays"] })
  .meta({
    id: "UpdateShareRequest",
    description:
      "Change a share: only the fields given change. History stays limited to precise shares.",
  });
export type UpdateShareRequest = z.input<typeof updateShareRequestSchema>;

/** `GET /api/v1/shares/incoming` */
export const incomingShareListResponseSchema = z.object({
  shares: z
    .array(incomingShareSchema)
    .meta({ description: "Current shares with you, hidden ones included, newest first." }),
});
export type IncomingShareListResponse = z.infer<typeof incomingShareListResponseSchema>;

/** `POST /api/v1/shares/incoming/{id}/hide` and `…/unhide` */
export const incomingShareResponseSchema = z.object({ share: incomingShareSchema });
export type IncomingShareResponse = z.infer<typeof incomingShareResponseSchema>;
