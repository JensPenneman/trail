import type { Server } from "node:http";
import request from "supertest";
import type { Agent } from "./authFlows";
import { testOrigin } from "./testEnvironment";

export interface RecordedPoint {
  /** Seconds before now. */
  ago: number;
  lat: number;
  lon: number;
  altitude?: number;
  speed?: number;
  course?: number;
}

/** An Overland upload of plain locations, recorded `ago` seconds before now. */
export function uploadOf(points: readonly RecordedPoint[], now = Date.now()) {
  return {
    locations: points.map((point) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [point.lon, point.lat] },
      properties: {
        // Overland's own format: whole seconds, UTC.
        timestamp: new Date(now - point.ago * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
        horizontal_accuracy: 5,
        altitude: point.altitude ?? 14.5,
        speed: point.speed ?? 3.5,
        course: point.course ?? 123,
        motion: ["walking"],
        battery_level: 0.66,
        battery_state: "unplugged",
        device_id: "phone",
      },
    })),
  };
}

/** A JSON request from the dashboard's origin, as the browser sends it (the CSRF guard wants the Origin). */
export function from(
  agent: Agent,
  method: "post" | "patch" | "delete",
  path: string,
  body?: object,
) {
  const pending = agent[method](path).set("Origin", testOrigin);
  return body === undefined ? pending : pending.send(body);
}

/** A request without any credential, like a visitor of a public link. */
export const anonymous = (app: Server, path: string) => request(app).get(path);
