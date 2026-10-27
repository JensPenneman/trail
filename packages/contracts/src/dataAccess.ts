import { z } from "zod";
import { exportFormats } from "./exportQuery";
import { sharePrecisionSchema } from "./share";
import { processingLevelSchema, transportModeSchema } from "./transport";

/*
 * The data access log (docs/architecture.md §8.7): every read of a person's
 * location data, and every change to it or to who may see it, recorded per
 * hour — who, through which channel, what — for that person alone to read.
 * Nothing in it is a coordinate, a secret or text that someone other than the
 * owner typed, except the names it shows to tell actors apart.
 */

/** How the data was reached. */
export const dataAccessChannels = ["web", "api", "mcp", "people", "live", "link"] as const;

export const dataAccessChannelSchema = z.enum(dataAccessChannels).meta({
  id: "DataAccessChannel",
  description:
    "`web`: your own signed-in browser. `api`: one of your API tokens. `mcp`: one of your API tokens through the MCP server. `people`: a person you share with, looking at you (People, their API token or their agent). `live`: a person you share with, receiving your new positions while their page is open. `link`: a visitor of one of your public links.",
  example: "people",
});
export type DataAccessChannel = z.infer<typeof dataAccessChannelSchema>;

/** Who reached it. */
export const dataAccessActorKinds = ["owner", "person", "link", "token"] as const;

export const dataAccessActorKindSchema = z.enum(dataAccessActorKinds).meta({
  id: "DataAccessActorKind",
  description:
    "`owner`: you, signed in. `token`: one of your API tokens (directly or through the MCP server). `person`: someone you share with. `link`: a visitor of one of your public links.",
  example: "person",
});
export type DataAccessActorKind = z.infer<typeof dataAccessActorKindSchema>;

/** What was done with it. */
export const dataAccessKinds = ["read", "write", "export"] as const;

export const dataAccessKindSchema = z.enum(dataAccessKinds).meta({
  id: "DataAccessKind",
  description:
    "`read`: data was shown or returned. `write`: something changed — a correction, a share, a link, a token, a deletion. `export`: a download of the raw data.",
  example: "read",
});
export type DataAccessKind = z.infer<typeof dataAccessKindSchema>;

/**
 * What an action is called: a v1 `operationId` (`getTracks`), a dashboard
 * route (`dashboard.export`), an MCP tool or resource (`mcp.get_timeline`),
 * `link.view` or `live.position`. Always one of the server's own names.
 */
export const dataAccessActionSchema = z
  .string()
  .max(64)
  .regex(/^[a-z][A-Za-z0-9_]*(\.[a-z][A-Za-z0-9_]*)*$/)
  .meta({ description: "What was done, by its name in Trail.", example: "getPersonTrack" });

const uuid = (description: string) =>
  z.uuid().meta({ description, example: "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3" });

/** A bound of a range: an instant in UTC, or a local day for ranges of days. */
const rangeBound = (description: string) =>
  z
    .union([z.iso.datetime(), z.iso.date()])
    .optional()
    .meta({ description, example: "2026-10-26T08:00:00.000Z" });

/** The longest list of devices an access names: the API's own limit for a device list. */
export const maxAccessDevices = 50;

/**
 * Which data an access touched, in the server's words: devices, a range, a
 * level, a precision, a mode, a share, a link or a token — never a
 * coordinate, never a bounding box, never anything a caller typed.
 */
export const dataAccessResourceSchema = z
  .object({
    deviceIds: z
      .array(z.uuid())
      .max(maxAccessDevices)
      .optional()
      .meta({
        description:
          "The devices whose data it was, sorted; left out when the access named none (every device the credential reaches).",
        example: ["0199a0f3-5fec-72ad-a30c-5ab9d8908cd3"],
      }),
    from: rangeBound("Start of the range that was asked for."),
    to: rangeBound("End of the range that was asked for."),
    at: z.iso.datetime().optional().meta({
      description: "The instant that was asked about.",
      example: "2026-10-26T08:00:00.000Z",
    }),
    date: z.iso
      .date()
      .optional()
      .meta({ description: "The local day that was asked about.", example: "2026-10-26" }),
    hours: z
      .number()
      .int()
      .positive()
      .optional()
      .meta({ description: "How many hours of recent activity.", example: 48 }),
    level: processingLevelSchema.optional(),
    precision: sharePrecisionSchema.optional(),
    mode: transportModeSchema.nullable().optional().meta({
      description: "The transport mode asked about or set; null when a mode was taken back.",
    }),
    format: z
      .enum(exportFormats)
      .optional()
      .meta({ description: "The export's format.", example: "gpx" }),
    historyDays: z.number().int().positive().nullable().optional().meta({
      description: "Days of history a share or link gives; null for live only.",
      example: 7,
    }),
    segmentId: uuid("The stop or move.").optional(),
    shareId: uuid("The share.").optional(),
    linkId: uuid("The public link.").optional(),
    tokenId: uuid("The API token.").optional(),
    folded: z.literal(true).optional().meta({
      description:
        "More accesses of this kind by this actor in this hour than are listed one by one: they are counted together here, without their details.",
    }),
  })
  .meta({
    id: "DataAccessResource",
    description: "Which data was read or changed. Never a coordinate.",
  });
export type DataAccessResource = z.infer<typeof dataAccessResourceSchema>;

const label = (description: string, example: string) => z.string().meta({ description, example });

/** A link visitor, as far as the owner learns about them: never their address. */
export const dataAccessVisitorSchema = z
  .object({
    key: z.string().meta({
      description:
        "Stands for one visitor — one network and one kind of browser — on your links; it cannot be turned back into an address.",
      example: "7d1c0a9e4b2f8c31",
    }),
    ipCoarse: z.string().nullable().meta({
      description:
        "The visitor's network: an IPv4 address with its last part zeroed (/24) or the first 48 bits of an IPv6 address; null when unknown.",
      example: "81.82.83.0/24",
    }),
    uaFamily: label("The kind of device and browser.", "iPhone · Safari"),
  })
  .meta({ id: "DataAccessVisitor", description: "An anonymous visitor of a public link." });
export type DataAccessVisitor = z.infer<typeof dataAccessVisitorSchema>;

/** Who it was: the current names while the actor exists, else the ones it had at the time. */
export const dataAccessActorSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("owner"),
        sessionLabel: label("The browser you were signed in with.", "Safari on iPhone"),
      })
      .meta({ id: "DataAccessOwner", description: "You, signed in." }),
    z
      .object({
        kind: z.literal("token"),
        tokenId: uuid("The token's id."),
        tokenName: label("The token's name.", "Home Assistant"),
      })
      .meta({ id: "DataAccessToken", description: "One of your API tokens." }),
    z
      .object({
        kind: z.literal("person"),
        userId: uuid("Their account."),
        displayName: label("Their name.", "Ana"),
        shareId: z.uuid().nullable().meta({
          description: "The share they looked through; null for a look that names none.",
          example: "019a2b4c-7d10-7e3a-9b21-5c8d0e6f1a23",
        }),
      })
      .meta({
        id: "DataAccessPerson",
        description:
          "Someone you share with. Their sessions, tokens, browsers and addresses are theirs: none of it is recorded.",
      }),
    z
      .object({
        kind: z.literal("link"),
        linkId: uuid("The link."),
        linkLabel: label("The link's label.", "On the way home"),
        visitor: dataAccessVisitorSchema.nullable().meta({
          description:
            "Null for visitors counted together when a link had more distinct visitors in an hour than are listed one by one.",
        }),
      })
      .meta({ id: "DataAccessLinkVisitor", description: "A visitor of one of your public links." }),
  ])
  .meta({ id: "DataAccessActor", description: "Who reached the data." });
export type DataAccessActor = z.infer<typeof dataAccessActorSchema>;

const instant = (description: string) =>
  z.iso.datetime().meta({ description, example: "2026-10-26T08:41:07.000Z" });

const count = (description: string) =>
  z.number().int().nonnegative().meta({ description, example: 14 });

/** One line of the log: the same access by the same actor within one UTC hour. */
export const dataAccessEventSchema = z
  .object({
    id: z
      .string()
      .regex(/^\d+\.[A-Za-z0-9_-]{43}$/)
      .meta({
        description: "Stands for the line, in this account's log only; pass it on as it is.",
        example: "498630.Hk3n0vQwz6Xh9cT0w1Y2bqk3o8G5mJr7y5dWl9sZeUA",
      }),
    bucketStart: instant("The UTC hour the line counts."),
    firstAt: instant("The first access in that hour."),
    lastAt: instant("The last access in that hour."),
    count: z
      .number()
      .int()
      .positive()
      .meta({ description: "How often, in that hour.", example: 3 }),
    actorKind: dataAccessActorKindSchema,
    channel: dataAccessChannelSchema,
    actor: dataAccessActorSchema,
    action: dataAccessActionSchema,
    access: dataAccessKindSchema,
    resource: dataAccessResourceSchema,
    status: z.number().int().meta({ description: "The status of the answer.", example: 200 }),
  })
  .meta({ id: "DataAccessEvent", description: "Accesses of one kind by one actor in one hour." });
export type DataAccessEvent = z.infer<typeof dataAccessEventSchema>;

/** Comma-separated values of an enum in a query string (`?actor=person,link`). */
const listOf = <T extends readonly [string, ...string[]]>(values: T, description: string) =>
  z
    .string()
    .transform((value) => [...new Set(value.split(",").filter((part) => part.length > 0))])
    .pipe(z.array(z.enum(values)).min(1))
    .meta({ description, example: values.slice(0, 2).join(",") });

/** A page of the log is at most this long. */
export const maxAccessLogLimit = 200;

/** `GET /api/v1/access-log` */
export const dataAccessLogQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }).optional().meta({
      description: "Hours from this instant on (the hour it falls in included).",
      example: "2026-10-20T00:00:00+02:00",
    }),
    to: z.iso
      .datetime({ offset: true })
      .optional()
      .meta({ description: "Hours before this instant.", example: "2026-10-27T00:00:00+01:00" }),
    actor: listOf(dataAccessActorKinds, "Only these kinds of actor, comma-separated.").optional(),
    channel: listOf(dataAccessChannels, "Only these channels, comma-separated.").optional(),
    action: dataAccessActionSchema.optional().meta({ description: "Only this action." }),
    cursor: z.string().min(1).max(200).optional().meta({
      description: "`nextCursor` of the previous page.",
    }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(maxAccessLogLimit)
      .default(50)
      .meta({
        description: `Lines per page, at most ${maxAccessLogLimit}.`,
        example: 50,
      }),
  })
  .refine(
    (range) =>
      range.from === undefined ||
      range.to === undefined ||
      Date.parse(range.to) > Date.parse(range.from),
    { message: "`to` must be after `from`", path: ["to"] },
  );
export type DataAccessLogQueryInput = z.input<typeof dataAccessLogQuerySchema>;

export const dataAccessLogResponseSchema = z
  .object({
    items: z.array(dataAccessEventSchema).meta({
      description:
        "Newest hour first; within an hour, in an order that stays the same from page to page.",
    }),
    nextCursor: z
      .string()
      .nullable()
      .meta({ description: "Pass as `cursor` for the next page; null on the last one." }),
  })
  .meta({ id: "DataAccessLog", description: "One page of the data access log." });
export type DataAccessLogResponse = z.infer<typeof dataAccessLogResponseSchema>;

/** The periods of the summary, in days. */
export const accessSummaryPeriods = ["7", "30", "90"] as const;

/** `GET /api/v1/access-log/summary` */
export const dataAccessSummaryQuerySchema = z.object({
  days: z
    .enum(accessSummaryPeriods)
    .default("30")
    .transform((value) => Number(value))
    .meta({
      description: "The period: the last 7, 30 or 90 local days, today included.",
      example: "30",
    }),
});
export type DataAccessSummaryQueryInput = z.input<typeof dataAccessSummaryQuerySchema>;

const byActorKind = z
  .object({
    owner: count("By you, signed in."),
    person: count("By people you share with."),
    link: count("By visitors of your links."),
    token: count("By your API tokens."),
  })
  .meta({ description: "Accesses per kind of actor." });

const byChannel = z
  .object({
    web: count("Your browser."),
    api: count("Your tokens."),
    mcp: count("Your tokens, through the MCP server."),
    people: count("People looking at you."),
    live: count("Live positions people received."),
    link: count("Public link views."),
  })
  .meta({ description: "Accesses per channel." });

const actionCount = z.object({ action: dataAccessActionSchema, count: count("How often.") });

export const dataAccessSummarySchema = z
  .object({
    timezone: z.string().meta({
      description: "The account's time zone: it decides the days.",
      example: "Europe/Brussels",
    }),
    days: z.number().int().positive().meta({ description: "The period in days.", example: 30 }),
    from: instant("The start of the period: the beginning of its first local day."),
    to: instant("The end of the period: now."),
    totals: z
      .object({
        events: count("Every access in the period."),
        byActorKind,
        byChannel,
        reads: count("Reads."),
        writes: count("Changes."),
        exports: count("Exports."),
      })
      .meta({ description: "The whole period." }),
    series: z
      .array(
        z.object({
          date: z.iso.date().meta({ description: "A local day.", example: "2026-10-26" }),
          events: count("Every access that day."),
          byActorKind,
        }),
      )
      .meta({ description: "Every day of the period, oldest first, days without any included." }),
    people: z
      .array(
        z.object({
          userId: uuid("Their account."),
          displayName: label("Their name.", "Ana"),
          events: count("How often they looked, live positions included."),
          lastAt: instant("When they last looked."),
          actions: z
            .array(actionCount)
            .meta({ description: "What they looked at, most often first." }),
        }),
      )
      .meta({ description: "The people who looked at you, most often first; at most 20." }),
    links: z
      .array(
        z.object({
          linkId: uuid("The link."),
          label: label("Its label.", "On the way home"),
          events: count("How often it was opened."),
          visitors: count("Distinct visitors (one network and one kind of browser each)."),
          lastAt: instant("When it was last opened."),
        }),
      )
      .meta({ description: "Your public links that were opened, most often first; at most 20." }),
    tokens: z
      .array(
        z.object({
          tokenId: uuid("The token."),
          name: label("Its name.", "Home Assistant"),
          events: count("How often it was used."),
          api: count("Of those, calls to the API."),
          mcp: count("Of those, calls through the MCP server."),
          lastAt: instant("When it was last used."),
          actions: z.array(actionCount).meta({ description: "What it did, most often first." }),
        }),
      )
      .meta({ description: "Your API tokens that were used, most often first; at most 20." }),
    own: z
      .object({
        events: count("Your own accesses, signed in."),
        lastAt: z.iso.datetime().nullable().meta({
          description: "Your last one; null when there was none.",
          example: "2026-10-26T08:41:07.000Z",
        }),
        sessions: z
          .array(
            z.object({
              label: label("The browser.", "Safari on iPhone"),
              events: count("Accesses from it."),
              lastAt: instant("The last one."),
            }),
          )
          .meta({ description: "By browser, most often first; at most 20." }),
      })
      .meta({
        description: "What you looked at yourself, signed in: kept apart from everyone else.",
      }),
  })
  .meta({ id: "DataAccessSummary", description: "Who looked at your data, over a period." });
export type DataAccessSummary = z.infer<typeof dataAccessSummarySchema>;
