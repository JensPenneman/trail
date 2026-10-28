import { apiPaths } from "@trail/contracts/apiPaths";
import {
  type ActivityResponse,
  activityQuerySchema,
  type DaysResponse,
  daysQuerySchema,
} from "@trail/contracts/stats";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAuth } from "../auth/requestAuth";
import { answerConditionally } from "../cache/answerConditionally";
import { weakEtag } from "../cache/weakEtag";
import { inputResource } from "../dataAccess/inputResource";
import { recordDashboardAccess } from "../dataAccess/recordDashboardAccess";
import { parseQuery } from "../http/parseInput";
import { findActivity } from "./findActivity";
import { findDayStats } from "./findDayStats";

/**
 * `GET /api/stats/days` (calendar, coverage; with the days' stamps, `304` for
 * an unchanged answer) and `GET /api/stats/activity` ("is data flowing").
 */
export function statsRouter(ctx: AppContext): Router {
  const router = express.Router();
  const { db } = ctx;

  router.get(apiPaths.statsDays, async (req, res) => {
    const auth = requireAuth(req);
    const query = parseQuery(daysQuerySchema, req);
    const body: DaysResponse = {
      timezone: auth.user.timezone,
      days: await findDayStats(db, auth, query),
    };
    // A few hundred small rows: their hash is the validator (docs/architecture.md §8.9).
    const etag = weakEtag(auth.user.id, apiPaths.statsDays, body);
    const status = await answerConditionally(req, res, etag, () => body);
    recordDashboardAccess(ctx, req, {
      action: "statsDays",
      kind: "read",
      resource: inputResource([query]),
      status,
    });
  });

  router.get(apiPaths.statsActivity, async (req, res) => {
    const auth = requireAuth(req);
    const query = parseQuery(activityQuerySchema, req);
    const body: ActivityResponse = await findActivity(db, auth, query);
    res.json(body);
    recordDashboardAccess(ctx, req, {
      action: "statsActivity",
      kind: "read",
      resource: inputResource([query]),
    });
  });

  return router;
}
