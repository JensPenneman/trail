import { z } from "zod";
import { batteryStates } from "./device";
import { instantRange } from "./query";

/** `GET /api/locations` — raw stored points of one device, newest first, keyset-paginated. */
export const locationsQuerySchema = z.object({
  deviceId: z.uuid(),
  /** Only points recorded before this instant (exclusive) — pass `nextCursor` here. */
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type LocationsQueryInput = z.input<typeof locationsQuerySchema>;

export const locationRowSchema = z.object({
  recordedAt: z.iso.datetime(),
  receivedAt: z.iso.datetime(),
  lat: z.number(),
  lon: z.number(),
  altitude: z.number().nullable(),
  speed: z.number().nullable(),
  course: z.number().nullable(),
  accuracy: z.number().nullable(),
  verticalAccuracy: z.number().nullable(),
  speedAccuracy: z.number().nullable(),
  courseAccuracy: z.number().nullable(),
  motion: z.array(z.string()),
  batteryLevel: z.number().nullable(),
  batteryState: z.enum(batteryStates).nullable(),
  wifi: z.string().nullable(),
  /** Remaining Overland properties that have no column (tracking stats, unique_id, …). */
  extra: z.record(z.string(), z.unknown()).nullable(),
});
export type LocationRow = z.infer<typeof locationRowSchema>;

export const locationsPageSchema = z.object({
  items: z.array(locationRowSchema),
  nextCursor: z.iso.datetime().nullable(),
});
export type LocationsPage = z.infer<typeof locationsPageSchema>;

/** `POST /api/locations/delete` — removes points, visits, trips and events of one device in `[from, to)`. */
export const deleteLocationsRequestSchema = instantRange(36_600).and(
  z.object({ deviceId: z.uuid() }),
);
export type DeleteLocationsRequest = z.input<typeof deleteLocationsRequestSchema>;

export const deleteLocationsResponseSchema = z.object({ deleted: z.number().int().nonnegative() });
export type DeleteLocationsResponse = z.infer<typeof deleteLocationsResponseSchema>;
