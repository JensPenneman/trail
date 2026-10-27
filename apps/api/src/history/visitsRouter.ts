import { apiPaths } from "@trail/contracts/apiPaths";
import { eventRangeQuerySchema, type VisitsResponse } from "@trail/contracts/visit";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAuth } from "../auth/requestAuth";
import { inputResource } from "../dataAccess/inputResource";
import { recordDashboardAccess } from "../dataAccess/recordDashboardAccess";
import { parseQuery } from "../http/parseInput";
import { findVisits } from "./findVisits";

/** `GET /api/visits` — visits touching `[from, to)`, arrival and departure reports merged. */
export function visitsRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get(apiPaths.visits, async (req, res) => {
    const auth = requireAuth(req);
    const query = parseQuery(eventRangeQuerySchema, req);
    const body: VisitsResponse = { visits: await findVisits(ctx.db, auth, query) };
    res.json(body);
    recordDashboardAccess(ctx, req, {
      action: "visits",
      kind: "read",
      resource: inputResource([query]),
    });
  });

  return router;
}
