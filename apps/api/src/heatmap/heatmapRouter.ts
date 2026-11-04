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
import { insightsScope } from "../insights/insightsScope";
import { insightsValidator } from "../insights/insightsValidator";
import { hasPendingWork } from "../processing/processingQueue";
import { chooseCellZoom } from "./chooseCellZoom";
import { findHeatCells } from "./findHeatCells";
import { findStopCells } from "./findStopCells";
import { heatCellCap } from "./heatCellCap";
import { heatValidator } from "./heatValidator";

/**
 * `GET /api/heatmap` — density in the viewport (docs/architecture.md §8.2): the points ever
 * recorded from the pre-aggregated cells, or the time spent at places and the visits to them over
 * a period of local days from the stops. `304` when nothing the answer is made of changed
 * (`heatValidator`; `insightsValidator` for the stop measures), the validator read before the cells.
 */
export function heatmapRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get(apiPaths.heatmap, async (req, res) => {
    const auth = requireAuth(req);
    const query = parseQuery(heatmapQuerySchema, req);
    const cellZoom = chooseCellZoom(query.zoom);
    const limit = heatCellCap(query.bbox, cellZoom);
    let status: number;
    if (query.heat === "points") {
      const deviceIds = (await resolveDeviceIds(ctx.db, auth, query.deviceIds)).map(
        (device) => device.id,
      );
      const etag = weakEtag(auth.user.id, apiPaths.heatmap, [
        { bbox: query.bbox, zoom: query.zoom, heat: query.heat },
        await heatValidator(ctx.db, deviceIds),
      ]);
      status = await answerConditionally(req, res, etag, async () => {
        const found = await findHeatCells(ctx.db, auth, query, { limit });
        const body: HeatmapResponse = {
          heat: "points",
          ...found,
          period: null,
          pending: false,
        };
        return body;
      });
    } else {
      // Own devices, the account's zone and a period of at most three years, as Insights has them.
      const scope = await insightsScope(ctx.db, auth, {
        from: query.from,
        to: query.to,
        devices: query.deviceIds,
      });
      const range = { startMs: scope.start.getTime(), endMs: scope.end.getTime() };
      const etag = weakEtag(auth.user.id, apiPaths.heatmap, [
        { bbox: query.bbox, zoom: query.zoom, heat: query.heat, period: scope.period },
        await insightsValidator(ctx.db, scope, range),
      ]);
      status = await answerConditionally(req, res, etag, async () => {
        const found = await findStopCells(ctx.db, {
          deviceIds: scope.deviceIds,
          heat: query.heat === "visits" ? "visits" : "time",
          bbox: query.bbox,
          cellZoom,
          start: scope.start,
          end: scope.end,
          limit,
        });
        const body: HeatmapResponse = {
          heat: query.heat,
          ...found,
          period: { from: scope.period.from, to: scope.period.to },
          pending: await hasPendingWork(ctx.db, scope.deviceIds, scope.start, scope.end),
        };
        return body;
      });
    }
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
