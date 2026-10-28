import { apiPaths } from "@trail/contracts/apiPaths";
import { type TracksResponse, tracksQuerySchema } from "@trail/contracts/track";
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
import { buildTrack } from "./buildTrack";

/**
 * `GET /api/tracks` — simplified tracks of the user's devices in `[from, to)`,
 * with the stamps of their days; `304` when `If-None-Match` names the ETag of
 * those stamps, which are read before the points (docs/architecture.md §8.9).
 */
export function tracksRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get(apiPaths.tracks, async (req, res) => {
    const auth = requireAuth(req);
    const query = parseQuery(tracksQuerySchema, req);
    const from = new Date(query.from);
    const to = new Date(query.to);
    const { deviceIds, days } = await stampRange(ctx.db, auth, {
      deviceIds: query.deviceIds,
      from,
      to,
    });
    const asked = {
      from: from.toISOString(),
      to: to.toISOString(),
      deviceIds,
      maxPoints: query.maxPoints,
      maxAccuracy: query.maxAccuracy,
    };
    const etag = weakEtag(auth.user.id, apiPaths.tracks, [asked, dayValidator(days)]);
    const status = await answerConditionally(req, res, etag, async () => {
      const tracks = [];
      // One device after the other: a long range per device is already a heavy query.
      for (const deviceId of deviceIds) {
        tracks.push(
          await buildTrack(ctx.db, deviceId, {
            from,
            to,
            maxAccuracy: query.maxAccuracy,
            maxPoints: query.maxPoints,
          }),
        );
      }
      const body: TracksResponse = {
        from: asked.from,
        to: asked.to,
        tracks,
        stamps: dayStampsOf(days),
      };
      return body;
    });
    recordDashboardAccess(ctx, req, {
      action: "tracks",
      kind: "read",
      resource: { ...inputResource([query]), level: "raw" },
      status,
    });
  });

  return router;
}
