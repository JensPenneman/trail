import { apiPaths } from "@trail/contracts/apiPaths";
import { exportQuerySchema } from "@trail/contracts/exportQuery";
import express, { type Router } from "express";
import type { AppContext } from "../appContext";
import { requireAuth } from "../auth/requestAuth";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";
import { parseQuery } from "../http/parseInput";
import { localDate } from "../lib/localDate";
import { writeChunk } from "../lib/writeChunk";
import { csvFormatter } from "./csvFormatter";
import type { ExportFormatter } from "./exportFormatter";
import { geojsonFormatter } from "./geojsonFormatter";
import { gpxFormatter } from "./gpxFormatter";
import { streamDevicePoints } from "./streamDevicePoints";

const formatterFor = (format: "geojson" | "gpx" | "csv", now: Date): ExportFormatter => {
  switch (format) {
    case "geojson":
      return geojsonFormatter();
    case "gpx":
      return gpxFormatter(now);
    case "csv":
      return csvFormatter();
  }
};

/**
 * `GET /api/export` — the user's points as a download, streamed page by page
 * with backpressure: memory stays flat for any range, and the database is not
 * queried further once the client has gone.
 */
export function exportRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get(apiPaths.export, async (req, res) => {
    const { user } = requireAuth(req);
    const query = parseQuery(exportQuerySchema, req);
    const owned = await resolveDeviceIds(ctx.db, user.id, query.deviceIds);
    const from = new Date(query.from);
    const to = new Date(query.to);
    const formatter = formatterFor(query.format, new Date());
    const lastDay = localDate(new Date(to.getTime() - 1), user.timezone);
    const filename = `trail-${localDate(from, user.timezone)}_${lastDay}.${formatter.extension}`;

    res.status(200);
    res.setHeader("Content-Type", formatter.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    if (!(await writeChunk(res, formatter.begin()))) return;
    for (const device of owned) {
      for await (const rows of streamDevicePoints(ctx.db, device.id, { from, to })) {
        if (!(await writeChunk(res, formatter.rows(device, rows)))) return;
      }
      if (!(await writeChunk(res, formatter.endDevice(device)))) return;
    }
    if (!(await writeChunk(res, formatter.end()))) return;
    res.end();
  });

  return router;
}
