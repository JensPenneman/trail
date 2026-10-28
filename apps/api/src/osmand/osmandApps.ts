import type { DeviceApp } from "@trail/contracts/deviceApp";

/** The apps that speak the OsmAnd format (`/api/osmand`). */
export type OsmandApp = Extract<DeviceApp, "traccar" | "osmand" | "gpslogger">;

export function isOsmandApp(app: DeviceApp): app is OsmandApp {
  return app === "traccar" || app === "osmand" || app === "gpslogger";
}

/**
 * What each app's `speed` parameter is, in m/s: Traccar Client sends knots
 * (Traccar's own unit; `toKnots` in its SDK, `speed * 1.943844` in the old
 * Android client), OsmAnd its location's m/s ({5}), GPSLogger's %SPD is m/s.
 * Decided by the app the device is set up for, never by the request.
 */
export const speedToMetresPerSecond: Readonly<Record<OsmandApp, number>> = {
  traccar: 1852 / 3600,
  osmand: 1,
  gpslogger: 1,
};
