import { toIso } from "../db/toIso";
import type { ExportFormatter } from "./exportFormatter";
import type { ExportDevice, ExportRow } from "./exportRow";

/*
 * Points as a GeoJSON FeatureCollection with Overland's own property names, so
 * an export can be replayed into any Overland receiver. Unknown values are
 * left out rather than written as null.
 */
function feature(device: ExportDevice, row: ExportRow): string {
  const properties: Record<string, unknown> = {
    ...row.extra,
    timestamp: toIso(row.recorded_at),
    device_id: device.deviceKey,
    device_name: device.name,
    altitude: row.altitude,
    speed: row.speed,
    course: row.course,
    horizontal_accuracy: row.horizontal_accuracy,
    vertical_accuracy: row.vertical_accuracy,
    speed_accuracy: row.speed_accuracy,
    course_accuracy: row.course_accuracy,
    motion: row.motion,
    battery_level: row.battery_level,
    battery_state: row.battery_state,
    wifi: row.wifi,
  };
  const present = Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== null),
  );
  return JSON.stringify({
    type: "Feature",
    geometry: { type: "Point", coordinates: [row.lon, row.lat] },
    properties: present,
  });
}

export function geojsonFormatter(): ExportFormatter {
  let written = 0;
  return {
    contentType: "application/geo+json; charset=utf-8",
    extension: "geojson",
    begin: () => '{"type":"FeatureCollection","features":[\n',
    rows: (device, rows) =>
      rows
        .map((row) => {
          const separator = written === 0 ? "" : ",\n";
          written += 1;
          return separator + feature(device, row);
        })
        .join(""),
    endDevice: () => "",
    end: () => "\n]}\n",
  };
}
