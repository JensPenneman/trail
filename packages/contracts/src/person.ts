import { z } from "zod";
import { batterySchema, devicePublicSchema, positionSchema } from "./devicePublic";
import { deviceIdsParamSchema } from "./query";
import { shareHistoryDaysSchema, sharePrecisionSchema } from "./share";
import { trackSchema } from "./track";
import { transportModeSchema } from "./transport";

/*
 * People who share their location with the caller, as their shares allow
 * (docs/architecture.md §8.5). Positions of approximate and area shares are
 * already coarsened by the server: nothing more precise ever leaves it.
 */

const instant = (description: string) =>
  z.iso.datetime().meta({ description, example: "2026-10-26T08:41:07.000Z" });

const userId = z.uuid().meta({
  description: "The person's account id.",
  example: "0199a0f2-11c4-7e0b-9c1d-2f5a8e4b7a60",
});

/**
 * Where a shared device is, at the precision of its share: the device's
 * position (`Position`) without its motion (an activity detail), with the
 * precision it was cut to.
 */
export const personLocationSchema = positionSchema
  .omit({ motion: true })
  .extend({
    lat: positionSchema.shape.lat.meta({
      description: "Latitude in degrees (WGS84); the centre of the share's cell when not precise.",
      example: 51.0543,
    }),
    accuracy: positionSchema.shape.accuracy.meta({
      description:
        "Radius in metres within which the device is; at least the cell size when not precise.",
      example: 556,
    }),
    speed: positionSchema.shape.speed.meta({
      description: "Speed in metres per second; null when unknown, and for `area` shares.",
      example: 4.2,
    }),
    course: positionSchema.shape.course.meta({
      description: "Direction of travel in degrees from north; precise shares only.",
      example: 87,
    }),
    altitude: positionSchema.shape.altitude.meta({
      description: "Altitude in metres; precise shares only.",
      example: 12,
    }),
    precision: sharePrecisionSchema,
  })
  .meta({ id: "PersonLocation", description: "A shared position, at the share's precision." });
export type PersonLocation = z.infer<typeof personLocationSchema>;

/** What a device is doing, shared only with `includeDetails`. */
export const personActivitySchema = z
  .object({
    motion: z.array(z.string()).meta({
      description: "Motion activity iOS reported with the position (`walking`, `automotive` …).",
      example: ["walking"],
    }),
    tripMode: z.string().nullable().meta({
      description: "The mode of a trip running in Overland right now, or null.",
      example: null,
    }),
    mode: transportModeSchema.nullable().meta({
      description:
        "How the device travels now, as Trail's location processing has it: the mode the owner set with the quick toggle, else that of the latest stop or move while it is recent (a stop is `stationary`); null when nothing recent is known.",
      example: "train",
    }),
  })
  .meta({ id: "PersonActivity", description: "What the device is doing." });
export type PersonActivity = z.infer<typeof personActivitySchema>;

/**
 * One device of a person, as their share shows it: the device's id and name
 * as the public API gives them (`Device`), and only what the share allows of
 * the rest.
 */
export const sharedDeviceSchema = devicePublicSchema
  .pick({ id: true, name: true })
  .extend({
    location: personLocationSchema.nullable().meta({
      description:
        "The newest position inside the share's window: within the last `historyDays` days, or for live-only shares within the server's live window (12 hours by default). Null when there is none.",
    }),
    battery: batterySchema
      .nullable()
      .meta({ description: "The last battery reading; null unless the share includes details." }),
    activity: personActivitySchema
      .nullable()
      .meta({ description: "Null unless the share includes details." }),
    distanceM: z.number().nonnegative().nullable().meta({
      description:
        "Metres from the caller's most recently located device to this position; null when either is unknown.",
      example: 1830,
    }),
  })
  .meta({ id: "SharedDevice", description: "A device someone shares with you." });
export type SharedDevice = z.infer<typeof sharedDeviceSchema>;

/** Someone who shares their location with the caller. */
export const personSchema = z
  .object({
    userId,
    displayName: z.string().meta({ description: "Their name in Trail.", example: "Jens" }),
    email: z.email().meta({ description: "Their address.", example: "jens@example.com" }),
    share: z
      .object({
        id: z.uuid().meta({
          description: "The share's id.",
          example: "019a2b4c-7d10-7e3a-9b21-5c8d0e6f1a23",
        }),
        precision: sharePrecisionSchema,
        historyDays: shareHistoryDaysSchema,
        includeDetails: z
          .boolean()
          .meta({ description: "Whether battery and activity are shared.", example: true }),
        expiresAt: z.iso.datetime().nullable().meta({
          description: "When the share ends by itself; null when it runs until stopped.",
          example: null,
        }),
        createdAt: instant("When they started sharing."),
      })
      .meta({ description: "What they share with you." }),
    devices: z
      .array(sharedDeviceSchema)
      .meta({ description: "The devices they share, oldest first." }),
  })
  .meta({ id: "Person", description: "Someone who shares their location with you." });
export type Person = z.infer<typeof personSchema>;

/** Path parameters of `/api/v1/people/{userId}…`. */
export const personParamsSchema = z.object({ userId });

/** `GET /api/v1/people` */
export const peopleResponseSchema = z.object({
  people: z.array(personSchema).meta({ description: "By name." }),
});
export type PeopleResponse = z.infer<typeof peopleResponseSchema>;

/** `GET /api/v1/people/{userId}` */
export const personResponseSchema = z.object({ person: personSchema });
export type PersonResponse = z.infer<typeof personResponseSchema>;

/** The longest range one call for a person's track may cover. */
export const maxPersonTrackDays = 93;

/** `GET /api/v1/people/{userId}/track` */
export const personTrackQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }).meta({
      description: "Start (inclusive). Earlier than the share's history allows: moved up to it.",
      example: "2026-10-25T00:00:00.000Z",
    }),
    to: z.iso
      .datetime({ offset: true })
      .meta({ description: "End (exclusive).", example: "2026-10-26T00:00:00.000Z" }),
    deviceIds: deviceIdsParamSchema.optional().meta({
      description: "Comma-separated ids of their shared devices; all of them by default.",
    }),
    maxPoints: z.coerce.number().int().min(100).max(50_000).default(8_000).meta({
      description: "At most this many points per device; longer tracks are simplified.",
      example: 8000,
    }),
  })
  .refine((range) => Date.parse(range.to) > Date.parse(range.from), {
    message: "`to` must be after `from`",
    path: ["to"],
  })
  .refine(
    (range) => Date.parse(range.to) - Date.parse(range.from) <= maxPersonTrackDays * 86_400_000,
    { message: `The range can span at most ${maxPersonTrackDays} days`, path: ["to"] },
  );
export type PersonTrackQueryInput = z.input<typeof personTrackQuerySchema>;

export const personTrackResponseSchema = z.object({
  from: instant("The start actually used: the requested one, or the start of the shared history."),
  to: instant("The end of the range."),
  tracks: z.array(trackSchema).meta({ description: "One track per shared device." }),
});
export type PersonTrackResponse = z.infer<typeof personTrackResponseSchema>;
