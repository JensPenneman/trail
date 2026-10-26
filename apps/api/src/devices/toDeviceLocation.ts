import type { DeviceLocation } from "@trail/contracts/devicePublic";
import { batteryStateOf } from "../overland/overlandValues";
import type { DeviceRow } from "./findOwnedDevice";

/** The device cache's newest position and battery reading; null before the first position. */
export function toDeviceLocation(device: DeviceRow): DeviceLocation | null {
  if (device.lastRecordedAt === null || device.lastLat === null || device.lastLon === null) {
    return null;
  }
  const level = device.batteryLevel;
  return {
    deviceId: device.id,
    lat: device.lastLat,
    lon: device.lastLon,
    recordedAt: device.lastRecordedAt.toISOString(),
    accuracy: device.lastAccuracy,
    speed: device.lastSpeed,
    course: device.lastCourse,
    altitude: device.lastAltitude,
    motion: device.lastMotion ?? [],
    battery:
      device.batteryRecordedAt === null
        ? null
        : {
            level: level !== null && level >= 0 && level <= 1 ? level : null,
            state: batteryStateOf(device.batteryState),
            recordedAt: device.batteryRecordedAt.toISOString(),
          },
  };
}
