import { trackGapSeconds } from "@trail/contracts/trackSegments";
import { toIso } from "../db/toIso";
import { escapeXml } from "./escapeXml";
import type { ExportFormatter } from "./exportFormatter";

/**
 * GPX 1.1: one `<trk>` per device (named after it) with a `<trkseg>` per
 * continuous segment — the same gap rule as the map, so a phone that stopped
 * logging does not get a straight line across the gap.
 */
export function gpxFormatter(exportedAt: Date): ExportFormatter {
  let trackOpen = false;
  let previousEpoch = 0;
  return {
    contentType: "application/gpx+xml; charset=utf-8",
    extension: "gpx",
    begin: () =>
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<gpx version="1.1" creator="Trail" xmlns="http://www.topografix.com/GPX/1/1" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n' +
      `<metadata><name>Trail export</name><time>${exportedAt.toISOString()}</time></metadata>\n`,
    rows: (device, rows) => {
      let out = "";
      for (const row of rows) {
        if (!trackOpen) {
          out += `<trk><name>${escapeXml(device.name)}</name><trkseg>\n`;
          trackOpen = true;
        } else if (row.epoch - previousEpoch > trackGapSeconds) {
          out += "</trkseg><trkseg>\n";
        }
        previousEpoch = row.epoch;
        const elevation = row.altitude === null ? "" : `<ele>${row.altitude}</ele>`;
        out += `<trkpt lat="${row.lat}" lon="${row.lon}">${elevation}<time>${toIso(row.recorded_at)}</time></trkpt>\n`;
      }
      return out;
    },
    endDevice: () => {
      if (!trackOpen) return "";
      trackOpen = false;
      return "</trkseg></trk>\n";
    },
    end: () => "</gpx>\n",
  };
}
