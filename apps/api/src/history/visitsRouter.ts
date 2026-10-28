import { apiPaths } from "@trail/contracts/apiPaths";
import { eventRangeQuerySchema, type VisitsResponse } from "@trail/contracts/visit";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAuth } from "../auth/requestAuth";
import { answerConditionally } from "../cache/answerConditionally";
import { dayStampsOf, dayValidator } from "../cache/dayStamps";
import { stampRange } from "../cache/stampRange";
import { weakEtag } from "../cache/weakEtag";
import { inputResource } from "../dataAccess/inputResource";
import { recordDashboardAccess } from "../dataAccess/recordDashboardAccess";
import { parseQuery } from "../http/parseInput";
import { findVisits } from "./findVisits";

/**
 * `GET /api/visits` — visits touching `[from, to)`, arrival and departure
 * reports merged, with the stamps of their days, read first; `304` when
 * `If-None-Match` names their ETag (docs/architecture.md §8.9).
 */
export function visitsRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get(apiPaths.visits, async (req, res) => {
    const auth = requireAuth(req);
    const query = parseQuery(eventRangeQuerySchema, req);
    const from = new Date(query.from);
    const to = new Date(query.to);
    const { deviceIds, days } = await stampRange(ctx.db, auth, {
      deviceIds: query.deviceIds,
      from,
      to,
    });
    const asked = { from: from.toISOString(), to: to.toISOString(), deviceIds };
    const etag = weakEtag(auth.user.id, apiPaths.visits, [asked, dayValidator(days)]);
    const status = await answerConditionally(req, res, etag, async () => {
      const body: VisitsResponse = {
        visits: await findVisits(ctx.db, auth, query),
        stamps: dayStampsOf(days),
      };
      return body;
    });
    recordDashboardAccess(ctx, req, {
      action: "visits",
      kind: "read",
      resource: inputResource([query]),
      status,
    });
  });

  return router;
}
