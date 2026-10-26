import { apiPaths } from "@trail/contracts/apiPaths";
import { type HeatmapResponse, heatmapQuerySchema } from "@trail/contracts/heatmap";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAuth } from "../auth/requestAuth";
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
  });

  return router;
}
