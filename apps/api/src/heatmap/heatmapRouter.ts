import { apiPaths } from "@trail/contracts/apiPaths";
import { type HeatmapResponse, heatmapQuerySchema } from "@trail/contracts/heatmap";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAuth } from "../auth/requestAuth";
import { answerConditionally } from "../cache/answerConditionally";
import { weakEtag } from "../cache/weakEtag";
import { inputResource } from "../dataAccess/inputResource";
import { recordDashboardAccess } from "../dataAccess/recordDashboardAccess";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";
import { parseQuery } from "../http/parseInput";
import { findHeatCells } from "./findHeatCells";
import { heatValidator } from "./heatValidator";

/**
 * `GET /api/heatmap` — all-time density in the viewport from the pre-aggregated
 * cells; `304` when nothing the cells are made of changed (`heatValidator`).
 */
export function heatmapRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get(apiPaths.heatmap, async (req, res) => {
    const auth = requireAuth(req);
    const query = parseQuery(heatmapQuerySchema, req);
    const deviceIds = (await resolveDeviceIds(ctx.db, auth, query.deviceIds)).map(
      (device) => device.id,
    );
    // The validator before the cells (docs/architecture.md §8.9).
    const etag = weakEtag(auth.user.id, apiPaths.heatmap, [
      { bbox: query.bbox, zoom: query.zoom },
      await heatValidator(ctx.db, deviceIds),
    ]);
    const status = await answerConditionally(req, res, etag, async () => {
      const body: HeatmapResponse = await findHeatCells(ctx.db, auth, query);
      return body;
    });
    // The devices only: the viewport is a place, which the log never keeps.
    recordDashboardAccess(ctx, req, {
      action: "heatmap",
      kind: "read",
      resource: inputResource([{ deviceIds: query.deviceIds }]),
      status,
    });
  });

  return router;
}
