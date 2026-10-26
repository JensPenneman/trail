import { z } from "zod";
import { batteryStates } from "./device";

/*
 * Devices as the public API (v1) shows them. The shapes are spelled out here
 * instead of derived from the dashboard's `DeviceSummary`, so a change to the
 * dashboard never changes v1, and nothing secret or administrative (token
 * hint, Overland Device ID, alerts, settings presets) can slip in.
 */

const deviceId = z.uuid().meta({
  description: "The device's id.",
  example: "0199a0f3-5fec-72ad-a30c-5ab9d8908cd3",
});

const instant = (description: string) =>
  z.iso.datetime().meta({ description, example: "2026-10-26T08:41:07.000Z" });

/** The last battery reading of a device. */
export const batterySchema = z
  .object({
    level: z.number().min(0).max(1).nullable().meta({
      description: "Charge from 0 to 1; null when the phone did not report it.",
      example: 0.82,
    }),
    state: z.enum(batteryStates).nullable().meta({
      description: "What the phone reported about charging; null when unknown.",
      example: "unplugged",
    }),
    recordedAt: instant("When the phone took the reading."),
  })
  .meta({ id: "Battery", description: "The last battery reading of the device." });
export type Battery = z.infer<typeof batterySchema>;

/** A recorded position: WGS84 degrees, metres, metres per second. */
export const positionSchema = z
  .object({
    lat: z.number().meta({ description: "Latitude in degrees (WGS84).", example: 51.0543 }),
    lon: z.number().meta({ description: "Longitude in degrees (WGS84).", example: 3.7174 }),
    recordedAt: instant("When the phone recorded the position."),
    accuracy: z.number().nullable().meta({
      description: "Horizontal accuracy in metres (radius); null when unknown.",
      example: 5,
    }),
    speed: z
      .number()
      .nullable()
      .meta({ description: "Speed in metres per second; null when unknown.", example: 4.2 }),
    course: z.number().nullable().meta({
      description: "Direction of travel in degrees clockwise from north; null when unknown.",
      example: 87,
    }),
    altitude: z
      .number()
      .nullable()
      .meta({ description: "Altitude in metres; null when unknown.", example: 12 }),
    motion: z.array(z.string()).meta({
      description: "Motion activity iOS reported with the position (`walking`, `automotive` …).",
      example: ["cycling"],
    }),
  })
  .meta({ id: "Position", description: "A position the phone recorded." });
export type Position = z.infer<typeof positionSchema>;

export const devicePublicSchema = z
  .object({
    id: deviceId,
    name: z.string().meta({ description: "Its name in Trail.", example: "Jens’s iPhone" }),
    source: z.enum(["overland"]).meta({ description: "The app that records it." }),
    createdAt: instant("When the device was added."),
    lastSeenAt: z.iso.datetime().nullable().meta({
      description: "Time of the last accepted upload of any kind; null before the first one.",
      example: "2026-10-26T08:42:00.000Z",
    }),
    lastLocation: positionSchema
      .nullable()
      .meta({ description: "The newest known position; null before the first one." }),
    battery: batterySchema.nullable(),
    liveTrip: z
      .object({
        mode: z.string().meta({ description: "Overland's trip mode.", example: "bicycle" }),
        startedAt: instant("When the trip started."),
        distanceM: z.number().meta({ description: "Distance so far in metres.", example: 3120 }),
      })
      .nullable()
      .meta({ description: "A trip running in Overland right now, or null." }),
    counts: z
      .object({
        today: z.number().int().nonnegative().meta({
          description: "Points recorded since midnight in the owner's time zone.",
          example: 1840,
        }),
        last24h: z
          .number()
          .int()
          .nonnegative()
          .meta({ description: "Points recorded in the last 24 hours.", example: 2310 }),
        total: z
          .number()
          .int()
          .nonnegative()
          .meta({ description: "Every point the device ever sent.", example: 182_040 }),
      })
      .meta({ description: "Number of stored points." }),
  })
  .meta({
    id: "Device",
    description:
      "A tracker: one install of Overland on a phone. Credentials and settings stay out.",
  });
export type DevicePublic = z.infer<typeof devicePublicSchema>;

/** Path parameters of `/api/v1/devices/{id}…`. */
export const deviceParamsSchema = z.object({ id: deviceId });

/** `GET /api/v1/devices` */
export const devicePublicListResponseSchema = z.object({
  devices: z.array(devicePublicSchema).meta({ description: "Oldest first." }),
});
export type DevicePublicListResponse = z.infer<typeof devicePublicListResponseSchema>;

/** `GET /api/v1/devices/{id}` */
export const devicePublicResponseSchema = z.object({ device: devicePublicSchema });
export type DevicePublicResponse = z.infer<typeof devicePublicResponseSchema>;

/** Where a device is now: its newest position and its last battery reading. */
export const deviceLocationSchema = positionSchema
  .extend({ deviceId, battery: batterySchema.nullable() })
  .meta({ id: "DeviceLocation", description: "The newest position of a device." });
export type DeviceLocation = z.infer<typeof deviceLocationSchema>;

/** `GET /api/v1/devices/{id}/location` — null until the device sends its first position. */
export const deviceLocationResponseSchema = z.object({
  location: deviceLocationSchema
    .nullable()
    .meta({ description: "Null until the device has sent a position." }),
});
export type DeviceLocationResponse = z.infer<typeof deviceLocationResponseSchema>;
