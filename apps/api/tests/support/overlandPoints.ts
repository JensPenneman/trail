import type { Server } from "node:http";
import type { RawPoint, VisitSpan } from "../../src/processing/pipelineTypes";
import { postOverland } from "./deviceFlows";

/** Overland's batches hold up to 1000 points (its largest "Locations per Batch"). */
const batchSize = 1000;

/** A recorded point as Overland sends it. */
export function overlandFeature(point: RawPoint) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [point.lon, point.lat] },
    properties: {
      timestamp: new Date(point.t * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      horizontal_accuracy: point.accuracy ?? -1,
      speed: point.speed ?? -1,
      altitude: point.altitude ?? 0,
      vertical_accuracy: point.verticalAccuracy ?? -1,
      motion: [...point.motion],
      battery_level: 0.8,
      battery_state: "unplugged",
      device_id: "test-phone",
    },
  };
}

/** Uploads a journey like the phone would: in batches, oldest first. */
export async function uploadJourney(
  app: Server,
  token: string,
  points: readonly RawPoint[],
): Promise<void> {
  for (let start = 0; start < points.length; start += batchSize) {
    const locations = points.slice(start, start + batchSize).map(overlandFeature);
    const response = await postOverland(app, token, { locations });
    if (response.status !== 200 || response.body?.result !== "ok") {
      throw new Error(`Upload refused: ${response.status} ${JSON.stringify(response.body)}`);
    }
  }
}

/** iOS's report of a visit as Overland sends it, made at `reportedAt` (epoch seconds). */
export function overlandVisit(visit: VisitSpan, reportedAt: number) {
  const iso = (t: number) => new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [visit.lon, visit.lat] },
    properties: {
      action: "visit",
      timestamp: iso(reportedAt),
      arrival_date: iso(visit.arrivedAt),
      departure_date: visit.departedAt === null ? null : iso(visit.departedAt),
      horizontal_accuracy: visit.accuracy ?? 30,
      device_id: "test-phone",
    },
  };
}

/** Uploads visit reports, each sent shortly after what it reports (the departure, else the arrival). */
export async function uploadVisits(
  app: Server,
  token: string,
  visits: readonly VisitSpan[],
): Promise<void> {
  const locations = visits.map((visit) =>
    overlandVisit(visit, (visit.departedAt ?? visit.arrivedAt) + 25),
  );
  const response = await postOverland(app, token, { locations });
  if (response.status !== 200 || response.body?.result !== "ok") {
    throw new Error(`Upload refused: ${response.status} ${JSON.stringify(response.body)}`);
  }
}
