import { z } from "zod";
import { sharedDeviceSchema } from "./person";
import {
  historyNeedsPrecise,
  type SharePrecision,
  shareDeviceIdsSchema,
  sharedDeviceIdsSchema,
  sharePrecisionSchema,
} from "./share";
import { trackPointSchema } from "./track";

/*
 * Public links (docs/architecture.md §8.4): a secret URL that shows the
 * owner's location to anyone who has it, without an account, until it
 * expires. The secret is shown once, when the link is created.
 */

/** A link secret: `trls_` and 32 random bytes in base64url. */
export const shareLinkSecretPattern = /^trls_[A-Za-z0-9_-]{43}$/;

/**
 * The request header that carries a link's secret to `GET /api/public/share`:
 * in no URL, so neither the server's access log nor a proxy's records it.
 */
export const shareSecretHeader = "X-Share-Secret";

/** A link runs this long unless the owner picks another expiry. */
export const defaultShareLinkHours = 24;
/** No link ends sooner than this. */
export const minShareLinkHours = 1;
/** No link outlives this. */
export const maxShareLinkDays = 30;
/** A public page draws the whole shared history on every refresh, so it stays short. */
export const maxShareLinkHistoryDays = 7;
/** At most this many points per device in a public page's track. */
export const publicTrackMaxPoints = 2_000;

const linkId = z.uuid().meta({
  description: "The link's id.",
  example: "019a2b4f-0c33-7a51-8d4e-6b7f1c2d3e4f",
});

const instant = (description: string) =>
  z.iso.datetime().meta({ description, example: "2026-10-27T08:41:07.000Z" });

const label = z.string().trim().min(1).max(60).meta({
  description: "Shown to visitors as the page's title.",
  example: "On the way home",
});

const linkHistoryDays = z
  .number()
  .int()
  .min(1)
  .max(maxShareLinkHistoryDays)
  .nullable()
  .meta({
    description: `Days of the past track visitors see (1–${maxShareLinkHistoryDays}); null for the newest position only. Only with \`precise\`.`,
    example: null,
  });

const includeDetails = z.boolean().meta({
  description: "Whether visitors see battery and activity too.",
  example: false,
});

/** A public link of the caller (the secret is never part of it). */
export const shareLinkSchema = z
  .object({
    id: linkId,
    label,
    deviceIds: sharedDeviceIdsSchema,
    precision: sharePrecisionSchema,
    historyDays: linkHistoryDays,
    includeDetails,
    expiresAt: instant("When the link stops working."),
    createdAt: instant("When the link was made."),
    status: z.enum(["active", "expired"]).meta({
      description: "`expired` links stay listed for 30 days, then they are removed.",
      example: "active",
    }),
    viewCount: z.number().int().nonnegative().meta({
      description: "How often the page was opened, counting at most once a minute.",
      example: 12,
    }),
    lastViewedAt: z.iso.datetime().nullable().meta({
      description: "When the page was last opened; null if never.",
      example: "2026-10-26T09:12:00.000Z",
    }),
  })
  .meta({ id: "ShareLink", description: "A secret web address that shows your location." });
export type ShareLink = z.infer<typeof shareLinkSchema>;

/** Path parameters of `/api/v1/share-links/{id}`. */
export const shareLinkParamsSchema = z.object({ id: linkId });

/** `GET /api/v1/share-links` */
export const shareLinkListResponseSchema = z.object({
  links: z.array(shareLinkSchema).meta({
    description:
      "Links that were not turned off: the working ones, then expired ones, each newest first, at most 50.",
  }),
});
export type ShareLinkListResponse = z.infer<typeof shareLinkListResponseSchema>;

const preciseForHistory = (body: {
  precision: SharePrecision;
  historyDays?: number | null | undefined;
}) => body.historyDays === undefined || body.historyDays === null || body.precision === "precise";

/** `POST /api/v1/share-links` */
export const createShareLinkRequestSchema = z
  .object({
    label: label.optional().meta({
      description: "Defaults to “Shared location”: visitors see nothing of your account.",
    }),
    deviceIds: shareDeviceIdsSchema.optional(),
    precision: sharePrecisionSchema,
    historyDays: linkHistoryDays.optional(),
    includeDetails: includeDetails.optional(),
    expiresAt: z.iso
      .datetime({ offset: true })
      .optional()
      .meta({
        description: `When the link stops working: at least ${minShareLinkHours} hour and at most ${maxShareLinkDays} days away. Defaults to ${defaultShareLinkHours} hours from now.`,
        example: "2026-10-27T08:41:07.000Z",
      }),
  })
  .refine(preciseForHistory, { message: historyNeedsPrecise, path: ["historyDays"] })
  .meta({ id: "CreateShareLinkRequest", description: "Make a public link to your location." });
export type CreateShareLinkRequest = z.input<typeof createShareLinkRequestSchema>;

/** `POST /api/v1/share-links` (201): the only answer that carries the secret. */
export const createShareLinkResponseSchema = z.object({
  link: shareLinkSchema,
  secret: z.string().regex(shareLinkSecretPattern).meta({
    description: "The link's secret, shown this once.",
    example: "trls_8kKZ2mQ1xVtC4pLr7nWb0sYe5uJa9dHf3gTq6oNi1Bc",
  }),
  url: z.url().meta({
    description:
      "The page to send: `<server>/s#<secret>`, shown this once. The secret is the fragment, which browsers never send to a server.",
    example: "https://trail.example.com/s#trls_8kKZ2mQ1xVtC4pLr7nWb0sYe5uJa9dHf3gTq6oNi1Bc",
  }),
});
export type CreateShareLinkResponse = z.infer<typeof createShareLinkResponseSchema>;

/**
 * A device on a public page: a shared device without its id or a distance (a
 * visitor has no position of their own here), with a key that means something
 * on this page alone, and the route when the link includes history.
 */
export const publicSharedDeviceSchema = sharedDeviceSchema
  .omit({ id: true, distanceM: true })
  .extend({
    /** Stable for this device on this link, and unrelated to its id. */
    key: z.string(),
    /** The track of the shared history (simplified), oldest first; null for live-only links. */
    track: z.array(trackPointSchema).nullable(),
  });
export type PublicSharedDevice = z.infer<typeof publicSharedDeviceSchema>;

/** `GET /api/public/share` with `X-Share-Secret` — what a link shows, without an account. */
export const publicShareResponseSchema = z.object({
  label: z.string(),
  expiresAt: z.iso.datetime(),
  precision: sharePrecisionSchema,
  historyDays: z.number().int().positive().nullable(),
  devices: z.array(publicSharedDeviceSchema),
});
export type PublicShareResponse = z.infer<typeof publicShareResponseSchema>;
