import type { SharedDevice } from "@trail/contracts/person";
import type { SharePrecision } from "@trail/contracts/share";
import type { DeviceRow } from "../devices/findOwnedDevice";
import { toDeviceLocation } from "../devices/toDeviceLocation";
import { haversineM } from "../tracks/haversine";
import { currentModeOf } from "./currentMode";
import { type GridScope, gridOffset, projectPosition } from "./gridProjection";
import type { LatLon } from "./latestOwnPositions";

/** What a share or a public link grants on a device. */
export interface Grant {
  scope: GridScope;
  /** The share's or the link's id: with the device it picks the grid. */
  id: string;
  precision: SharePrecision;
  includeDetails: boolean;
}

/**
 * A device as a grant shows it to someone else (docs/architecture.md §8.4),
 * cut down from the owner's own public view of it (`toDeviceLocation`): its
 * id and name, the newest position recorded since `from` at the grant's
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
  const newest = toDeviceLocation(device);
  const inWindow = (instant: string) => Date.parse(instant) >= context.from.getTime();
  const visible = newest !== null && inWindow(newest.recordedAt) ? newest : null;
  const location =
    visible === null
      ? null
      : projectPosition(
          { ...visible, recordedAt: new Date(visible.recordedAt) },
          grant.precision,
          gridOffset(context.key, grant.scope, grant.id, device.id),
        );
  const battery = newest?.battery ?? null;
  return {
    id: device.id,
    name: device.name,
    location,
    battery:
      grant.includeDetails && battery !== null && inWindow(battery.recordedAt) ? battery : null,
    activity:
      grant.includeDetails && visible !== null
        ? {
            motion: visible.motion,
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
