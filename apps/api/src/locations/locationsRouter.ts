import { apiPaths } from "@trail/contracts/apiPaths";
import {
  type DeleteLocationsResponse,
  deleteLocationsRequestSchema,
  type LocationsPage,
  locationsQuerySchema,
} from "@trail/contracts/location";
import { and, desc, eq, lt } from "drizzle-orm";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAuth } from "../auth/requestAuth";
import { locations } from "../db/schema/locations";
import { findOwnedDevice } from "../devices/findOwnedDevice";
import { publishDeviceLater } from "../devices/publishDevice";
import { parseBody, parseQuery } from "../http/parseInput";
import { batteryStateOf } from "../overland/overlandValues";
import { deleteLocationRange } from "./deleteLocationRange";

/** `GET /api/locations` (raw points, newest first) and `POST /api/locations/delete`. */
export function locationsRouter(ctx: AppContext): Router {
  const router = express.Router();
  const { db } = ctx;

  router.get(apiPaths.locations, async (req, res) => {
    const { user } = requireAuth(req);
    const query = parseQuery(locationsQuerySchema, req);
    const device = await findOwnedDevice(db, user.id, query.deviceId);
    const rows = await db
      .select()
      .from(locations)
      .where(
        and(
          eq(locations.deviceId, device.id),
          query.before === undefined ? undefined : lt(locations.recordedAt, new Date(query.before)),
        ),
      )
      .orderBy(desc(locations.recordedAt))
      .limit(query.limit + 1);
    const items = rows.slice(0, query.limit);
    const body: LocationsPage = {
      items: items.map((row) => ({
        recordedAt: row.recordedAt.toISOString(),
        receivedAt: row.receivedAt.toISOString(),
        lat: row.lat,
        lon: row.lon,
        altitude: row.altitude,
        speed: row.speed,
        course: row.course,
        accuracy: row.horizontalAccuracy,
        verticalAccuracy: row.verticalAccuracy,
        speedAccuracy: row.speedAccuracy,
        courseAccuracy: row.courseAccuracy,
        motion: row.motion,
        batteryLevel: row.batteryLevel,
        batteryState: batteryStateOf(row.batteryState),
        wifi: row.wifi,
        extra: row.extra,
      })),
      nextCursor:
        rows.length > query.limit ? (items.at(-1)?.recordedAt.toISOString() ?? null) : null,
    };
    res.json(body);
  });

  router.post(apiPaths.deleteLocations, async (req, res) => {
    const { user } = requireAuth(req);
    const request = parseBody(deleteLocationsRequestSchema, req);
    const device = await findOwnedDevice(db, user.id, request.deviceId);
    const deleted = await deleteLocationRange(db, {
      deviceId: device.id,
      timezone: user.timezone,
      from: new Date(request.from),
      to: new Date(request.to),
    });
    ctx.logger.info({ deviceId: device.id, deleted }, "points deleted");
    publishDeviceLater(ctx, user.id, device.id);
    const body: DeleteLocationsResponse = { deleted };
    res.json(body);
  });

  return router;
}
