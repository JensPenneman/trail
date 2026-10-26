import type { SharedDevice } from "@trail/contracts/person";
import type { SharePrecision } from "@trail/contracts/share";
import type { DeviceRow } from "../devices/findOwnedDevice";
import { batteryStateOf } from "../overland/overlandValues";
import { haversineM } from "../tracks/haversine";
import { currentModeOf } from "./currentMode";
import {
  type GridScope,
  gridOffset,
  projectPosition,
  type RecordedPosition,
} from "./gridProjection";
import type { LatLon } from "./latestOwnPositions";

/** What a share or a public link grants on a device. */
export interface Grant {
  scope: GridScope;
  /** The share's or the link's id: with the device it picks the grid. */
  id: string;
  precision: SharePrecision;
  includeDetails: boolean;
}

/** The device cache's newest position, or null before the first one. */
function recordedPosition(device: DeviceRow): RecordedPosition | null {
  if (device.lastRecordedAt === null || device.lastLat === null || device.lastLon === null) {
    return null;
  }
  return {
    lat: device.lastLat,
    lon: device.lastLon,
    accuracy: device.lastAccuracy,
    recordedAt: device.lastRecordedAt,
    speed: device.lastSpeed,
    course: device.lastCourse,
    altitude: device.lastAltitude,
  };
}

/**
 * A device as a grant shows it to someone else (docs/architecture.md §8.4):
 * its name, the newest position recorded since `from`, at the grant's
 * precision, and — only when the grant includes details — the battery reading
 * and activity of that window. The distance starts from the viewer's own
 * position and ends at the projected one, so it reveals no more than the
 * position does. Nothing else of the device (tokens, keys, settings, alerts,
 * counts) is part of the result.
 */
export function toSharedDevice(
  device: DeviceRow,
  grant: Grant,
  context: { key: Buffer; from: Date; viewerAt: LatLon | null },
): SharedDevice {
  const position = recordedPosition(device);
  const visible =
    position !== null && position.recordedAt.getTime() >= context.from.getTime() ? position : null;
  const location =
    visible === null
      ? null
      : projectPosition(
          visible,
          grant.precision,
          gridOffset(context.key, grant.scope, grant.id, device.id),
        );
  const batteryAt = device.batteryRecordedAt;
  const level = device.batteryLevel;
  const battery =
    grant.includeDetails && batteryAt !== null && batteryAt.getTime() >= context.from.getTime()
      ? {
          level: level !== null && level >= 0 && level <= 1 ? level : null,
          state: batteryStateOf(device.batteryState),
          recordedAt: batteryAt.toISOString(),
        }
      : null;
  return {
    id: device.id,
    name: device.name,
    location,
    battery,
    activity:
      grant.includeDetails && location !== null
        ? {
            motion: device.lastMotion ?? [],
            tripMode: device.liveTrip?.mode ?? null,
            mode: currentModeOf(device),
          }
        : null,
    distanceM:
      location === null || context.viewerAt === null
        ? null
        : Math.round(haversineM(context.viewerAt, location)),
  };
}
