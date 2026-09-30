import { toIso } from "../db/toIso";
import { csvField } from "./csvField";
import type { ExportFormatter } from "./exportFormatter";

const header = [
  "device_id",
  "device_name",
  "device_key",
  "recorded_at",
  "received_at",
  "lat",
  "lon",
  "altitude",
  "speed",
  "course",
  "horizontal_accuracy",
  "vertical_accuracy",
  "speed_accuracy",
  "course_accuracy",
  "motion",
  "battery_level",
  "battery_state",
  "wifi",
];

/**
 * The points as CSV with a header row and CRLF line ends (RFC 4180); `motion`
 * values are joined with ";". One table holds one kind of row: visits and trips
 * are in the GeoJSON (and the visits in the GPX) export.
 */
export function csvFormatter(): ExportFormatter {
  return {
    contentType: "text/csv; charset=utf-8",
    extension: "csv",
    begin: () => `${header.join(",")}\r\n`,
    visits: () => "",
    trips: () => "",
    rows: (device, rows) =>
      rows
        .map(
          (row) =>
            `${[
              csvField(device.id),
              csvField(device.name),
              csvField(device.deviceKey),
              csvField(toIso(row.recorded_at)),
              csvField(toIso(row.received_at)),
              csvField(row.lat),
              csvField(row.lon),
              csvField(row.altitude),
              csvField(row.speed),
              csvField(row.course),
              csvField(row.horizontal_accuracy),
              csvField(row.vertical_accuracy),
              csvField(row.speed_accuracy),
              csvField(row.course_accuracy),
              csvField(row.motion.join(";")),
              csvField(row.battery_level),
              csvField(row.battery_state),
              csvField(row.wifi),
            ].join(",")}\r\n`,
        )
        .join(""),
    endDevice: () => "",
    end: () => "",
  };
}
