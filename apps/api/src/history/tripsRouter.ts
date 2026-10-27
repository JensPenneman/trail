import { apiPaths } from "@trail/contracts/apiPaths";
import type { TripsResponse } from "@trail/contracts/trip";
import { eventRangeQuerySchema } from "@trail/contracts/visit";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAuth } from "../auth/requestAuth";
import { inputResource } from "../dataAccess/inputResource";
import { recordDashboardAccess } from "../dataAccess/recordDashboardAccess";
import { parseQuery } from "../http/parseInput";
import { findTrips } from "./findTrips";

/** `GET /api/trips` — Overland trips overlapping `[from, to)`. */
export function tripsRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get(apiPaths.trips, async (req, res) => {
    const auth = requireAuth(req);
    const query = parseQuery(eventRangeQuerySchema, req);
    const body: TripsResponse = { trips: await findTrips(ctx.db, auth, query) };
    res.json(body);
    recordDashboardAccess(ctx, req, {
      action: "trips",
      kind: "read",
      resource: inputResource([query]),
    });
  });

  return router;
}
