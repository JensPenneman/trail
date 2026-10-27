import { apiPaths } from "@trail/contracts/apiPaths";
import { type HeatmapResponse, heatmapQuerySchema } from "@trail/contracts/heatmap";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAuth } from "../auth/requestAuth";
import { inputResource } from "../dataAccess/inputResource";
import { recordDashboardAccess } from "../dataAccess/recordDashboardAccess";
import { parseQuery } from "../http/parseInput";
import { findHeatCells } from "./findHeatCells";

/** `GET /api/heatmap` — all-time density in the viewport from the pre-aggregated cells. */
export function heatmapRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get(apiPaths.heatmap, async (req, res) => {
    const auth = requireAuth(req);
    const query = parseQuery(heatmapQuerySchema, req);
    const body: HeatmapResponse = await findHeatCells(ctx.db, auth, query);
    res.json(body);
    // The devices only: the viewport is a place, which the log never keeps.
    recordDashboardAccess(ctx, req, {
      action: "heatmap",
      kind: "read",
      resource: inputResource([{ deviceIds: query.deviceIds }]),
    });
  });

  return router;
}
