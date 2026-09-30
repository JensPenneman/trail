import { apiPaths } from "@trail/contracts/apiPaths";
import {
  createDeviceRequestSchema,
  type DeviceListResponse,
  type DeviceResponse,
  type DeviceWithCredentialsResponse,
  updateDeviceRequestSchema,
} from "@trail/contracts/device";
import { type IngestLogResponse, ingestLogQuerySchema } from "@trail/contracts/ingestLog";
import { desc, eq } from "drizzle-orm";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAuth } from "../auth/requestAuth";
import { allowLongStatements } from "../db/allowLongStatements";
import { devices } from "../db/schema/devices";
import { ingestLog } from "../db/schema/ingestLog";
import { parseBody, parseQuery } from "../http/parseInput";
import { createDevice } from "./createDevice";
import { deviceCredentials } from "./deviceCredentials";
import { findOwnedDevice } from "./findOwnedDevice";
import { generateDeviceToken } from "./generateDeviceToken";
import { loadDeviceSummaries } from "./loadDeviceSummaries";
import { loadDeviceSummary } from "./loadDeviceSummary";
import { publishDevice } from "./publishDevice";

/** `/api/devices*` — the user's trackers, their credentials and upload audit log. */
export function devicesRouter(ctx: AppContext): Router {
  const router = express.Router();
  const { db, config } = ctx;

  router.get(apiPaths.devices.root, async (req, res) => {
    const { user } = requireAuth(req);
    const body: DeviceListResponse = {
      devices: await loadDeviceSummaries(db, { userId: user.id }),
    };
    res.json(body);
  });

  router.post(apiPaths.devices.root, async (req, res) => {
    const { user } = requireAuth(req);
    const request = parseBody(createDeviceRequestSchema, req);
    const created = await createDevice(db, {
      userId: user.id,
      name: request.name,
      deviceKey: request.deviceKey,
    });
    const device = await loadDeviceSummary(db, user.id, created.id);
    publishDevice(ctx, user.id, device);
    ctx.logger.info({ deviceId: created.id, userId: user.id }, "device created");
    const body: DeviceWithCredentialsResponse = {
      device,
      credentials: deviceCredentials({
        ingestUrl: config.ingestUrl,
        accessToken: created.token,
        deviceKey: created.deviceKey,
      }),
    };
    res.status(201).json(body);
  });

  router.get("/api/devices/:id", async (req, res) => {
    const { user } = requireAuth(req);
    const body: DeviceResponse = { device: await loadDeviceSummary(db, user.id, req.params.id) };
    res.json(body);
  });

  router.patch("/api/devices/:id", async (req, res) => {
    const { user } = requireAuth(req);
    const changes = parseBody(updateDeviceRequestSchema, req);
    const existing = await findOwnedDevice(db, user.id, req.params.id);
    await db
      .update(devices)
      .set({
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.alertsEnabled === undefined ? {} : { alertsEnabled: changes.alertsEnabled }),
        // With alerts off there must be no "sending again" message later either.
        ...(changes.alertsEnabled === false ? { staleAlertedAt: null } : {}),
        ...(changes.pendingSettings === undefined
          ? {}
          : { pendingSettings: changes.pendingSettings }),
        updatedAt: new Date(),
      })
      .where(eq(devices.id, existing.id));
    const device = await loadDeviceSummary(db, user.id, existing.id);
    publishDevice(ctx, user.id, device);
    const body: DeviceResponse = { device };
    res.json(body);
  });

  router.delete("/api/devices/:id", async (req, res) => {
    const { user } = requireAuth(req);
    const existing = await findOwnedDevice(db, user.id, req.params.id);
    // The cascade removes every point of the device, which can be millions of rows.
    await db.transaction(async (tx) => {
      await allowLongStatements(tx);
      await tx.delete(devices).where(eq(devices.id, existing.id));
    });
    ctx.bus.publish(user.id, { type: "device-removed", deviceId: existing.id });
    ctx.logger.info({ deviceId: existing.id, userId: user.id }, "device deleted");
    res.status(204).end();
  });

  router.post("/api/devices/:id/token", async (req, res) => {
    const { user } = requireAuth(req);
    const existing = await findOwnedDevice(db, user.id, req.params.id);
    const token = generateDeviceToken();
    await db
      .update(devices)
      .set({ tokenHash: token.hash, tokenHint: token.hint, updatedAt: new Date() })
      .where(eq(devices.id, existing.id));
    const device = await loadDeviceSummary(db, user.id, existing.id);
    publishDevice(ctx, user.id, device);
    ctx.logger.info({ deviceId: existing.id }, "device token rotated");
    const body: DeviceWithCredentialsResponse = {
      device,
      credentials: deviceCredentials({
        ingestUrl: config.ingestUrl,
        accessToken: token.token,
        deviceKey: existing.deviceKey,
      }),
    };
    res.json(body);
  });

  router.get("/api/devices/:id/ingest-log", async (req, res) => {
    const { user } = requireAuth(req);
    const existing = await findOwnedDevice(db, user.id, req.params.id);
    const { limit } = parseQuery(ingestLogQuerySchema, req);
    const rows = await db
      .select()
      .from(ingestLog)
      .where(eq(ingestLog.deviceId, existing.id))
      .orderBy(desc(ingestLog.receivedAt), desc(ingestLog.id))
      .limit(limit);
    const body: IngestLogResponse = {
      entries: rows.map((row) => ({
        id: String(row.id),
        receivedAt: row.receivedAt.toISOString(),
        records: row.records,
        locations: row.locations,
        duplicates: row.duplicates,
        visits: row.visits,
        trips: row.trips,
        events: row.events,
        rejected: row.rejected,
        durationMs: row.durationMs,
        userAgent: row.userAgent,
      })),
    };
    res.json(body);
  });

  return router;
}
