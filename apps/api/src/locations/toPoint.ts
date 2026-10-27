import type { Point } from "@trail/contracts/locationPublic";
import { batteryStateOf } from "../ingest/ingestValues";
import type { LocationRecord } from "./readPoints";

/**
 * A stored point as v1 shows it: picked field by field, so nothing else leaks —
 * neither the Wi-Fi network nor `extra`, Overland's other properties, which
 * carry its own ids and would pass on whatever a later app version adds.
 */
export function toPoint(row: LocationRecord): Point {
  const level = row.batteryLevel !== null && row.batteryLevel >= 0 && row.batteryLevel <= 1;
  const state = batteryStateOf(row.batteryState);
  return {
    deviceId: row.deviceId,
    recordedAt: row.recordedAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    lat: row.lat,
    lon: row.lon,
    accuracy: row.horizontalAccuracy,
    verticalAccuracy: row.verticalAccuracy,
    speed: row.speed,
    speedAccuracy: row.speedAccuracy,
    course: row.course,
    courseAccuracy: row.courseAccuracy,
    altitude: row.altitude,
    motion: row.motion,
    battery:
      !level && state === null
        ? null
        : {
            level: level ? row.batteryLevel : null,
            state,
            recordedAt: row.recordedAt.toISOString(),
          },
  };
}
