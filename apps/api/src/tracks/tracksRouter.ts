import { apiPaths } from "@trail/contracts/apiPaths";
import { type TracksResponse, tracksQuerySchema } from "@trail/contracts/track";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAuth } from "../auth/requestAuth";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";
import { parseQuery } from "../http/parseInput";
import { buildTrack } from "./buildTrack";

/** `GET /api/tracks` — simplified tracks of the user's devices in `[from, to)`. */
export function tracksRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get(apiPaths.tracks, async (req, res) => {
    const { user } = requireAuth(req);
    const query = parseQuery(tracksQuerySchema, req);
    const owned = await resolveDeviceIds(ctx.db, user.id, query.deviceIds);
    const from = new Date(query.from);
    const to = new Date(query.to);
    const tracks = [];
    // One device after the other: a long range per device is already a heavy query.
    for (const device of owned) {
      tracks.push(
        await buildTrack(ctx.db, device.id, {
          from,
          to,
          maxAccuracy: query.maxAccuracy,
          maxPoints: query.maxPoints,
        }),
      );
    }
    const body: TracksResponse = { from: from.toISOString(), to: to.toISOString(), tracks };
    res.json(body);
  });

  return router;
}
