import { apiPaths } from "@trail/contracts/apiPaths";
import {
  createDeviceRequestSchema,
  type DeviceListResponse,
  type DeviceResponse,
  type DeviceWithCredentialsResponse,
  rotateDeviceTokenRequestSchema,
  updateDeviceRequestSchema,
} from "@trail/contracts/device";
import { type IngestLogResponse, ingestLogQuerySchema } from "@trail/contracts/ingestLog";
import { desc, eq } from "drizzle-orm";
import express, { type Router } from "express";
import { forgetDeviceInTokens } from "../apiTokens/forgetDeviceInTokens";
import type { AppContext } from "../appContext";
import { requireAuth, requireSession } from "../auth/requestAuth";
import { answerConditionally } from "../cache/answerConditionally";
import { weakEtag } from "../cache/weakEtag";
import { recordDashboardAccess } from "../dataAccess/recordDashboardAccess";
import { allowLongStatements } from "../db/allowLongStatements";
import { devices } from "../db/schema/devices";
import { ingestLog } from "../db/schema/ingestLog";
import { parseBody, parseQuery } from "../http/parseInput";
import { announceShareChange } from "../sharing/announceShareChange";
import { removeDeviceFromShares } from "../sharing/removeDeviceFromShares";
import { changeDevice } from "./changeDevice";
import { createDevice } from "./createDevice";
import { deviceCredentials } from "./deviceCredentials";
import { deviceListValidator } from "./deviceListValidator";
import { findOwnedDevice } from "./findOwnedDevice";
import { generateDeviceToken } from "./generateDeviceToken";
import { loadDeviceSummaries } from "./loadDeviceSummaries";
import { loadDeviceSummary } from "./loadDeviceSummary";
import { publishDevice } from "./publishDevice";

/**
 * `/api/devices*` — the user's trackers, their credentials and upload audit log.
 * Whatever creates, replaces or destroys a device token — or moves a device to
 * another app, which takes a new token — needs the browser session.
 */
export function devicesRouter(ctx: AppContext): Router {
  const router = express.Router();
  const { db, config } = ctx;

  router.get(apiPaths.devices.root, async (req, res) => {
    const auth = requireAuth(req);
    // The validator first, the summaries only when it changed (docs/architecture.md §8.9).
    const etag = weakEtag(auth.user.id, apiPaths.devices.root, await deviceListValidator(db, auth));
    await answerConditionally(req, res, etag, async () => {
      const body: DeviceListResponse = { devices: await loadDeviceSummaries(db, auth) };
      return body;
    });
  });

  router.post(apiPaths.devices.root, async (req, res) => {
    const auth = requireSession(req);
    const { user } = auth;
    const request = parseBody(createDeviceRequestSchema, req);
    const created = await createDevice(db, {
      userId: user.id,
      name: request.name,
      source: request.source,
      deviceKey: request.deviceKey,
    });
    const device = await loadDeviceSummary(db, auth, created.id);
    publishDevice(ctx, user.id, device);
    ctx.logger.info(
      { deviceId: created.id, userId: user.id, app: request.source },
      "device created",
    );
    const body: DeviceWithCredentialsResponse = {
      device,
      credentials: deviceCredentials({
        app: request.source,
        ingestUrls: config.ingestUrls,
        accessToken: created.token,
        deviceKey: created.deviceKey,
        deviceName: device.name,
      }),
    };
    res.status(201).json(body);
  });

  router.get("/api/devices/:id", async (req, res) => {
    const body: DeviceResponse = {
      device: await loadDeviceSummary(db, requireAuth(req), req.params.id),
    };
    res.json(body);
  });

  router.patch("/api/devices/:id", async (req, res) => {
    const auth = requireAuth(req);
    const changes = parseBody(updateDeviceRequestSchema, req);
    const body: DeviceResponse = { device: await changeDevice(ctx, auth, req.params.id, changes) };
    res.json(body);
  });

  router.delete("/api/devices/:id", async (req, res) => {
    const auth = requireSession(req);
    const { user } = auth;
    const existing = await findOwnedDevice(db, auth, req.params.id);
    // The cascade removes every point of the device, which can be millions of rows.
    const sharedWith = await db.transaction(async (tx) => {
      await allowLongStatements(tx);
      const showing = await removeDeviceFromShares(tx, user.id, existing.id);
      await tx.delete(devices).where(eq(devices.id, existing.id));
      // After the delete, which waits for token changes that hold the device: they are in by now.
      await forgetDeviceInTokens(tx, user.id, existing.id);
      return showing;
    });
    ctx.bus.publish(user.id, { type: "device-removed", deviceId: existing.id });
    // Whoever saw the device through a share is told the share changed.
    ctx.sharing.forget(user.id);
    for (const share of sharedWith) {
      announceShareChange(ctx, {
        shareId: share.id,
        ownerId: user.id,
        recipientId: share.recipientUserId,
        change: "updated",
      });
    }
    ctx.logger.info({ deviceId: existing.id, userId: user.id }, "device deleted");
    res.status(204).end();
    recordDashboardAccess(ctx, req, {
      action: "deleteDevice",
      kind: "write",
      resource: { deviceIds: [existing.id] },
      status: 204,
    });
  });

  router.post("/api/devices/:id/token", async (req, res) => {
    const auth = requireSession(req);
    const request = req.body === undefined ? {} : parseBody(rotateDeviceTokenRequestSchema, req);
    const existing = await findOwnedDevice(db, auth, req.params.id);
    const app = request.source ?? existing.source;
    const token = generateDeviceToken();
    await db
      .update(devices)
      .set({
        tokenHash: token.hash,
        tokenHint: token.hint,
        source: app,
        // A preset waits for Overland's next upload; another app would never take it.
        ...(app === "overland" ? {} : { pendingSettings: null }),
        updatedAt: new Date(),
      })
      .where(eq(devices.id, existing.id));
    const device = await loadDeviceSummary(db, auth, existing.id);
    publishDevice(ctx, auth.user.id, device);
    ctx.logger.info(
      {
        deviceId: existing.id,
        app,
        ...(app === existing.source ? {} : { previousApp: existing.source }),
      },
      "device token rotated",
    );
    const body: DeviceWithCredentialsResponse = {
      device,
      credentials: deviceCredentials({
        app,
        ingestUrls: config.ingestUrls,
        accessToken: token.token,
        deviceKey: existing.deviceKey,
        deviceName: existing.name,
      }),
    };
    res.json(body);
  });

  router.get("/api/devices/:id/ingest-log", async (req, res) => {
    const existing = await findOwnedDevice(db, requireAuth(req), req.params.id);
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
        source: row.source,
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
