import { z } from "zod";
import { localDateSchema } from "./datetime";
import { deviceIdsParamSchema } from "./query";

/*
 * How a device travelled (docs/architecture.md §17): the processing levels of
 * a track, the stops and moves of the timeline, the transport modes inferred
 * for the moves and the corrections a person makes to them.
 */

/** Transport modes, in the order of the reference and the mode pickers. */
export const transportModes = [
  "stationary",
  "walking",
  "running",
  "cycling",
  "car",
  "bus",
  "tram",
  "metro",
  "train",
  "boat",
  "plane",
  "unknown",
] as const;

export const transportModeSchema = z.enum(transportModes).meta({
  id: "TransportMode",
  description:
    "How the device travelled. `stationary` is standing still; `unknown` means the evidence was too weak to decide.",
  example: "train",
});
export type TransportMode = z.infer<typeof transportModeSchema>;

/** The modes a person can choose: every mode but `unknown`. */
export const chosenModeSchema = transportModeSchema.exclude(["unknown"]).meta({
  id: "ChosenTransportMode",
  description: "A transport mode a person can set: every mode except `unknown`.",
  example: "train",
});
export type ChosenMode = z.infer<typeof chosenModeSchema>;

/** The road and rail classes the map matching distinguishes (from OpenStreetMap tags). */
export const wayKinds = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "residential",
  "service",
  "track",
  "cycleway",
  "footway",
  "path",
  "rail",
  "light_rail",
  "tram",
  "subway",
  "ferry",
  "other",
] as const;
export type WayKind = (typeof wayKinds)[number];

/** Levels of calculation, each one built on the one before. */
export const processingLevels = ["raw", "averaged", "mapped", "inferred"] as const;

export const processingLevelSchema = z.enum(processingLevels).meta({
  id: "ProcessingLevel",
  description:
    "`raw`: the points as the phone sent them. `averaged`: outliers dropped and GPS noise smoothed. `mapped`: snapped to roads and railways, with the way's shape between points. `inferred`: cut into stops and moves, each move with its transport mode.",
  example: "inferred",
});
export type ProcessingLevel = z.infer<typeof processingLevelSchema>;

/** Where a correction came from: the dashboard, the API or an agent (MCP). */
export const modeOverrideSources = ["ui", "api", "mcp"] as const;
export type ModeOverrideSource = (typeof modeOverrideSources)[number];

const instant = (description: string) =>
  z.iso.datetime().meta({ description, example: "2026-10-26T08:41:07.000Z" });

const segmentId = z.uuid().meta({
  description: "The segment's id. It stays the same while the segment keeps its start.",
  example: "019a1f7e-3c55-7b42-9d0e-5b7f3a1c2d4e",
});

const deviceId = z.uuid().meta({
  description: "The device's id.",
  example: "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3",
});

const devicesParam = deviceIdsParamSchema.optional().meta({
  description: "Comma-separated device ids; all devices the credential may reach when omitted.",
  example: "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3",
});

interface InstantRange {
  from: string;
  to: string;
}

const toAfterFrom = (range: InstantRange): boolean => Date.parse(range.to) > Date.parse(range.from);

/** Tracks and the timeline cover at most 93 days per request, like the dashboard's tracks. */
const withinTrackRange = (range: InstantRange): boolean =>
  Date.parse(range.to) - Date.parse(range.from) <= 93 * 86_400_000;

export const coordinateSchema = z
  .object({
    lat: z.number().meta({ description: "Latitude in degrees (WGS84).", example: 51.0362 }),
    lon: z.number().meta({ description: "Longitude in degrees (WGS84).", example: 3.7104 }),
  })
  .meta({ id: "Coordinate", description: "A position in WGS84 degrees." });
export type Coordinate = z.infer<typeof coordinateSchema>;

/** A stop or a move of the timeline. */
export const segmentSchema = z
  .object({
    id: segmentId,
    deviceId,
    kind: z.enum(["stop", "move"]).meta({
      description: "`stop`: the device stayed in one place. `move`: it travelled.",
      example: "move",
    }),
    startedAt: instant("Start of the segment."),
    endedAt: instant("End of the segment; the next segment starts here."),
    durationS: z
      .number()
      .nonnegative()
      .meta({ description: "Duration in seconds.", example: 2280 }),
    distanceM: z
      .number()
      .nonnegative()
      .meta({ description: "Distance travelled in metres; 0 for a stop.", example: 31_240 }),
    mode: transportModeSchema.nullable().meta({
      description:
        "The transport mode that counts: the person's choice, else the inferred one. Null for a stop.",
    }),
    modeInferred: transportModeSchema.nullable().meta({
      description: "The mode Trail worked out; null for a stop.",
    }),
    modeUser: chosenModeSchema.nullable().meta({
      description: "The mode a person set for this time; null when nobody did.",
    }),
    confidence: z.number().min(0).max(1).nullable().meta({
      description: "How sure the inference is, from 0 to 1; null for a stop.",
      example: 0.86,
    }),
    needsReview: z.boolean().meta({
      description: "The inference is unsure and nobody has set the mode: worth a look.",
      example: false,
    }),
    averageSpeed: z.number().nonnegative().nullable().meta({
      description: "Distance over duration in m/s; null for a stop.",
      example: 13.7,
    }),
    maxSpeed: z.number().nonnegative().nullable().meta({
      description: "Top speed in m/s (outliers left out); null for a stop.",
      example: 38.1,
    }),
    pointCount: z
      .number()
      .int()
      .nonnegative()
      .meta({ description: "Recorded points in the segment.", example: 41 }),
    start: coordinateSchema.meta({ description: "Where the segment starts." }),
    end: coordinateSchema.meta({ description: "Where the segment ends." }),
    centroid: coordinateSchema.meta({ description: "The middle of its points: a stop's place." }),
  })
  .meta({
    id: "Segment",
    description:
      "A stop or a move. Stops and moves follow each other without overlap; a gap in the recording leaves a gap between them.",
  });
export type Segment = z.infer<typeof segmentSchema>;

/** `GET /api/v1/segments` */
export const timelineQuerySchema = z
  .object({
    devices: devicesParam,
    from: z.iso.datetime({ offset: true }).meta({
      description: "Start of the range (inclusive).",
      example: "2026-10-25T23:00:00Z",
    }),
    to: z.iso.datetime({ offset: true }).meta({
      description: "End of the range (exclusive), at most 93 days after `from`.",
      example: "2026-10-26T23:00:00Z",
    }),
    cursor: z.string().min(1).max(200).optional().meta({
      description: "`nextCursor` of the previous page.",
    }),
    limit: z.coerce.number().int().min(1).max(1000).default(500).meta({
      description: "Segments per page.",
      example: 500,
    }),
  })
  .refine(toAfterFrom, { message: "`to` must be after `from`", path: ["to"] })
  .refine(withinTrackRange, { message: "The range can span at most 93 days", path: ["to"] });
export type TimelineQueryInput = z.input<typeof timelineQuerySchema>;

export const timelineResponseSchema = z
  .object({
    items: z.array(segmentSchema).meta({
      description: "Segments overlapping the range, oldest first.",
    }),
    nextCursor: z
      .string()
      .nullable()
      .meta({ description: "Pass as `cursor` for the next page; null on the last one." }),
    pending: z.boolean().meta({
      description: "Recorded points in the range are still waiting to be processed.",
      example: false,
    }),
  })
  .meta({ id: "Timeline", description: "Stops and moves, one page." });
export type TimelineResponse = z.infer<typeof timelineResponseSchema>;

/** `[lon, lat, t]`: WGS84 degrees and epoch seconds. */
export const levelPointSchema = z.tuple([z.number(), z.number(), z.number().int()]).meta({
  id: "LevelPoint",
  description:
    "`[lon, lat, t]`: WGS84 degrees and the time in epoch seconds. On the mapped level the way's shape between two recorded points carries interpolated times.",
  example: [3.7104, 51.0362, 1_793_000_000],
});
export type LevelPoint = z.infer<typeof levelPointSchema>;

/** `GET /api/v1/tracks` */
export const levelTracksQuerySchema = z
  .object({
    devices: devicesParam,
    from: z.iso.datetime({ offset: true }).meta({
      description: "Start of the range (inclusive).",
      example: "2026-10-25T23:00:00Z",
    }),
    to: z.iso.datetime({ offset: true }).meta({
      description: "End of the range (exclusive), at most 93 days after `from`.",
      example: "2026-10-26T23:00:00Z",
    }),
    level: processingLevelSchema.default("raw"),
    maxPoints: z.coerce.number().int().min(100).max(50_000).default(8000).meta({
      description: "At most this many points per device; longer tracks are simplified.",
      example: 8000,
    }),
  })
  .refine(toAfterFrom, { message: "`to` must be after `from`", path: ["to"] })
  .refine(withinTrackRange, { message: "The range can span at most 93 days", path: ["to"] });
export type LevelTracksQueryInput = z.input<typeof levelTracksQuerySchema>;

export const levelTrackSegmentSchema = z
  .object({
    id: segmentId.nullable().meta({
      description: "The timeline segment (inferred level); null for a piece of track.",
    }),
    deviceId,
    kind: z.enum(["stop", "move", "track"]).meta({
      description:
        "`stop` and `move` on the inferred level; `track`: a continuous piece of track (the other levels, and points not processed yet).",
      example: "move",
    }),
    level: processingLevelSchema.meta({
      description: "The level this segment's points reached.",
    }),
    mode: transportModeSchema.nullable(),
    modeInferred: transportModeSchema.nullable(),
    modeUser: chosenModeSchema.nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    needsReview: z.boolean(),
    startedAt: instant("Time of its first point."),
    endedAt: instant("Time of its last point."),
    distanceM: z
      .number()
      .nonnegative()
      .meta({ description: "Distance in metres.", example: 31_240 }),
    points: z.array(levelPointSchema),
  })
  .meta({ id: "TrackSegment", description: "A drawable piece of a device's track." });
export type LevelTrackSegment = z.infer<typeof levelTrackSegmentSchema>;

export const levelTracksResponseSchema = z
  .object({
    level: processingLevelSchema.meta({ description: "The level asked for." }),
    availableLevel: processingLevelSchema.meta({
      description:
        "The level every point of the response reached. Lower than `level` while points wait for processing or map data.",
    }),
    from: instant("Start of the range."),
    to: instant("End of the range."),
    simplified: z.boolean().meta({
      description: "Points were left out to stay within `maxPoints`.",
      example: false,
    }),
    segments: z.array(levelTrackSegmentSchema).meta({
      description: "Per device in the order of the devices, oldest first.",
    }),
  })
  .meta({ id: "Tracks", description: "Tracks at a level of calculation." });
export type LevelTracksResponse = z.infer<typeof levelTracksResponseSchema>;

/** A person's correction of the transport mode. */
export const modeOverrideSchema = z
  .object({
    id: z.uuid().meta({ description: "The override's id." }),
    deviceId,
    kind: z.enum(["segment", "toggle"]).meta({
      description:
        "`segment`: set for one segment's time. `toggle`: set from a moment on, until `until` or the next stop.",
      example: "toggle",
    }),
    mode: chosenModeSchema,
    from: instant("Where it starts."),
    until: z.iso.datetime().nullable().meta({
      description: "Where it ends at the latest; null: at the next stop.",
      example: null,
    }),
    source: z.enum(modeOverrideSources).meta({
      description: "`ui` (the dashboard), `api` (an API token) or `mcp` (an agent).",
      example: "ui",
    }),
    createdAt: instant("When it was set."),
  })
  .meta({ id: "ModeOverride", description: "A transport mode set by a person." });
export type ModeOverride = z.infer<typeof modeOverrideSchema>;

/** Path parameters of `/api/v1/segments/{id}/mode`. */
export const segmentParamsSchema = z.object({ id: segmentId });

/** `PUT /api/v1/segments/{id}/mode` */
export const setSegmentModeRequestSchema = z
  .object({ mode: chosenModeSchema })
  .meta({ id: "SetSegmentModeRequest", description: "The mode the segment really had." });
export type SetSegmentModeRequest = z.infer<typeof setSegmentModeRequestSchema>;

/** `PUT` and `DELETE /api/v1/segments/{id}/mode` */
export const segmentResponseSchema = z.object({ segment: segmentSchema });
export type SegmentResponse = z.infer<typeof segmentResponseSchema>;

/** `POST /api/v1/devices/{id}/mode` */
export const setDeviceModeRequestSchema = z
  .object({
    mode: chosenModeSchema.nullable().meta({
      description: "The mode from now on; null ends the mode set before and inference takes over.",
    }),
    until: z.iso.datetime({ offset: true }).optional().meta({
      description: "End it at this time at the latest (it always ends at the next stop).",
      example: "2026-10-26T10:30:00Z",
    }),
  })
  .meta({ id: "SetDeviceModeRequest", description: "Set the transport mode from now on." });
export type SetDeviceModeRequest = z.input<typeof setDeviceModeRequestSchema>;

export const deviceModeSchema = z
  .object({
    override: modeOverrideSchema.nullable().meta({
      description: "The mode set from a moment on that is still in force, or null.",
    }),
    current: z
      .object({
        mode: transportModeSchema,
        setByUser: z.boolean().meta({ description: "A person set it.", example: true }),
        since: instant("Since when."),
        segmentId: z.uuid().nullable().meta({
          description: "The segment of the timeline it comes from; null before processing.",
        }),
      })
      .nullable()
      .meta({
        description: "What the device is doing now, when its last segment is recent; else null.",
      }),
  })
  .meta({ id: "DeviceMode", description: "A device's transport mode now." });
export type DeviceMode = z.infer<typeof deviceModeSchema>;

/** `GET` and `POST /api/v1/devices/{id}/mode` */
export const deviceModeResponseSchema = z.object({ mode: deviceModeSchema });
export type DeviceModeResponse = z.infer<typeof deviceModeResponseSchema>;

/** `GET /api/v1/stats/modes` */
export const modeStatsQuerySchema = z
  .object({
    devices: devicesParam,
    from: localDateSchema.meta({
      description: "First local day (the account's time zone).",
      example: "2026-10-01",
    }),
    to: localDateSchema.meta({ description: "Last local day, inclusive.", example: "2026-10-31" }),
  })
  .refine((query) => query.to >= query.from, {
    message: "`to` must not be before `from`",
    path: ["to"],
  })
  .refine((query) => Date.parse(query.to) - Date.parse(query.from) <= 400 * 86_400_000, {
    message: "The range can span at most 400 days",
    path: ["to"],
  });
export type ModeStatsQueryInput = z.input<typeof modeStatsQuerySchema>;

export const modeDayStatSchema = z
  .object({
    date: localDateSchema.meta({ description: "The local day.", example: "2026-10-26" }),
    deviceId,
    mode: transportModeSchema.meta({ description: "The mode; stops count as `stationary`." }),
    distanceM: z.number().nonnegative().meta({ description: "Metres.", example: 31_240 }),
    durationS: z.number().nonnegative().meta({ description: "Seconds.", example: 2280 }),
    segments: z
      .number()
      .int()
      .nonnegative()
      .meta({ description: "Segments that count towards it.", example: 2 }),
    setByUser: z
      .number()
      .int()
      .nonnegative()
      .meta({ description: "Of those, the ones whose mode a person set.", example: 1 }),
  })
  .meta({
    id: "ModeDayStat",
    description:
      "Distance and time of one device in one mode on one local day. A segment across midnight counts on both days, in proportion to its time.",
  });
export type ModeDayStat = z.infer<typeof modeDayStatSchema>;

export const modeStatsResponseSchema = z
  .object({
    timezone: z
      .string()
      .meta({ description: "The time zone of the days.", example: "Europe/Brussels" }),
    days: z.array(modeDayStatSchema).meta({ description: "By day, device and mode." }),
  })
  .meta({ id: "ModeStats", description: "Distance and time per mode and local day." });
export type ModeStatsResponse = z.infer<typeof modeStatsResponseSchema>;
