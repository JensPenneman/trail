import { apiPaths } from "@trail/contracts/apiPaths";
import {
  type DeleteLocationsResponse,
  deleteLocationsRequestSchema,
  type LocationsPage,
  locationsQuerySchema,
} from "@trail/contracts/location";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAuth } from "../auth/requestAuth";
import { recordDashboardAccess } from "../dataAccess/recordDashboardAccess";
import { findOwnedDevice } from "../devices/findOwnedDevice";
import { publishDeviceLater } from "../devices/publishDevice";
import { parseBody, parseQuery } from "../http/parseInput";
import { batteryStateOf } from "../overland/overlandValues";
import { deleteLocationRange } from "./deleteLocationRange";
import { readPoints } from "./readPoints";

/** `GET /api/locations` (raw points, newest first) and `POST /api/locations/delete`. */
export function locationsRouter(ctx: AppContext): Router {
  const router = express.Router();
  const { db } = ctx;

  router.get(apiPaths.locations, async (req, res) => {
    const auth = requireAuth(req);
    const query = parseQuery(locationsQuerySchema, req);
    const device = await findOwnedDevice(db, auth, query.deviceId);
    const { rows: items, more } = await readPoints(db, device.id, {
      order: "desc",
      after: query.before === undefined ? undefined : new Date(query.before),
      limit: query.limit,
    });
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
      nextCursor: more ? (items.at(-1)?.recordedAt.toISOString() ?? null) : null,
    };
    res.json(body);
    // Every page of the device's points is the same read: the cursor stays out.
    recordDashboardAccess(ctx, req, {
      action: "locations",
      kind: "read",
      resource: { deviceIds: [device.id] },
    });
  });

  router.post(apiPaths.deleteLocations, async (req, res) => {
    const auth = requireAuth(req);
    const { user } = auth;
    const request = parseBody(deleteLocationsRequestSchema, req);
    const device = await findOwnedDevice(db, auth, request.deviceId);
    const deleted = await deleteLocationRange(db, {
      deviceId: device.id,
      timezone: user.timezone,
      from: new Date(request.from),
      to: new Date(request.to),
      queueProcessing: ctx.processing.enabled,
    });
    ctx.processing.notify();
    ctx.logger.info({ deviceId: device.id, deleted }, "points deleted");
    publishDeviceLater(ctx, user.id, device.id);
    const body: DeleteLocationsResponse = { deleted };
    res.json(body);
    recordDashboardAccess(ctx, req, {
      action: "deleteLocations",
      kind: "write",
      resource: {
        deviceIds: [device.id],
        from: new Date(request.from).toISOString(),
        to: new Date(request.to).toISOString(),
      },
    });
  });

  return router;
}
