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
import { parseQuery } from "../http/parseInput";
import { findActivity } from "./findActivity";
import { findDayStats } from "./findDayStats";

/** `GET /api/stats/days` (calendar, coverage) and `GET /api/stats/activity` ("is data flowing"). */
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
    res.json(body);
  });

  router.get(apiPaths.statsActivity, async (req, res) => {
    const auth = requireAuth(req);
    const query = parseQuery(activityQuerySchema, req);
    const body: ActivityResponse = await findActivity(db, auth, query);
    res.json(body);
  });

  return router;
}
