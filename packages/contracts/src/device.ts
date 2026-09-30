import { z } from "zod";
import { remoteSettingsPresetSchema } from "./remoteSettings";

export const batteryStates = ["unknown", "charging", "full", "unplugged"] as const;

/** The Overland "Device ID" (sent as `device_id` in every record): lower-case slug. */
export const deviceKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lower-case letters, digits and single dashes");

/** Everything the dashboard shows about one device (`GET /api/devices`, SSE `device` events). */
export const deviceSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  source: z.enum(["overland"]),
  deviceKey: z.string(),
  /** Last 4 characters of the access token, to tell tokens apart. */
  tokenHint: z.string(),
  alertsEnabled: z.boolean(),
  createdAt: z.iso.datetime(),
  /** Time of the last accepted upload (any record kind), or null if the device never sent data. */
  lastSeenAt: z.iso.datetime().nullable(),
  /** Newest known position (stored point or the payload's `current`). */
  lastLocation: z
    .object({
      lat: z.number(),
      lon: z.number(),
      recordedAt: z.iso.datetime(),
      accuracy: z.number().nullable(),
      speed: z.number().nullable(),
      altitude: z.number().nullable(),
      course: z.number().nullable(),
      motion: z.array(z.string()),
    })
    .nullable(),
  battery: z
    .object({
      /** 0..1 */
      level: z.number().min(0).max(1).nullable(),
      state: z.enum(batteryStates).nullable(),
      recordedAt: z.iso.datetime(),
    })
    .nullable(),
  /** Trip in progress on the phone (Overland `trip` object), or null. */
  liveTrip: z
    .object({ mode: z.string(), startedAt: z.iso.datetime(), distanceM: z.number() })
    .nullable(),
  counts: z.object({
    /** Points recorded since local midnight in the owner's time zone. */
    today: z.number().int().nonnegative(),
    last24h: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  /** Preset queued for the next ingest response, or null. */
  pendingSettings: remoteSettingsPresetSchema.nullable(),
  settingsAppliedAt: z.iso.datetime().nullable(),
});
export type DeviceSummary = z.infer<typeof deviceSummarySchema>;

export const deviceListResponseSchema = z.object({ devices: z.array(deviceSummarySchema) });
export type DeviceListResponse = z.infer<typeof deviceListResponseSchema>;

export const deviceResponseSchema = z.object({ device: deviceSummarySchema });
export type DeviceResponse = z.infer<typeof deviceResponseSchema>;

/** `POST /api/devices` — `deviceKey` defaults to a slug of the name plus a short random suffix. */
export const createDeviceRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  deviceKey: deviceKeySchema.optional(),
});
export type CreateDeviceRequest = z.input<typeof createDeviceRequestSchema>;

/** `PATCH /api/devices/:id` */
export const updateDeviceRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    alertsEnabled: z.boolean().optional(),
    /** Queue a preset for the next upload, or null to cancel a queued one. */
    pendingSettings: remoteSettingsPresetSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");
export type UpdateDeviceRequest = z.input<typeof updateDeviceRequestSchema>;

/** What the phone needs. The access token is shown exactly once (create / rotate). */
export const deviceCredentialsSchema = z.object({
  /** Overland "Receiver Endpoint". */
  endpoint: z.url(),
  /** Overland "Access Token" (sent as `Authorization: Bearer …`). */
  accessToken: z.string(),
  /** Overland "Device ID". */
  deviceKey: z.string(),
  /** `overland://setup?url=…&token=…&device_id=…` — opens Overland with everything filled in. */
  setupUrl: z.string().startsWith("overland://setup?"),
});
export type DeviceCredentials = z.infer<typeof deviceCredentialsSchema>;

/** Response of `POST /api/devices` and `POST /api/devices/:id/token` (rotation invalidates the old token). */
export const deviceWithCredentialsResponseSchema = z.object({
  device: deviceSummarySchema,
  credentials: deviceCredentialsSchema,
});
export type DeviceWithCredentialsResponse = z.infer<typeof deviceWithCredentialsResponseSchema>;
