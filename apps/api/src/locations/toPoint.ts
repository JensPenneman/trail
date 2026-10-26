import type { Point } from "@trail/contracts/locationPublic";
import { batteryStateOf } from "../overland/overlandValues";
import type { LocationRecord } from "./readPoints";

/** A stored point as v1 shows it: picked field by field, so nothing else leaks. */
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
    wifi: row.wifi,
    extra: row.extra,
  };
}
