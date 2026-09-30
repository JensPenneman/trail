import { trackGapSeconds } from "@trail/contracts/trackSegments";
import { toIso, toIsoOrNull } from "../db/toIso";
import { escapeXml } from "./escapeXml";
import type { ExportFormatter } from "./exportFormatter";
import type { ExportDevice } from "./exportRow";
import type { ExportVisit } from "./exportVisit";

/** A visit as a waypoint at its arrival, with the stay in its description. */
function waypoint(device: ExportDevice, visit: ExportVisit): string {
  const arrived = toIsoOrNull(visit.arrived_at);
  const departed = toIsoOrNull(visit.departed_at);
  const stay = [
    arrived === null ? null : `arrived ${arrived}`,
    departed === null ? null : `left ${departed}`,
  ].filter((part) => part !== null);
  const description = stay.length === 0 ? "" : `<desc>${stay.join(", ")}</desc>`;
  return (
    `<wpt lat="${visit.lat}" lon="${visit.lon}"><time>${arrived ?? toIso(visit.recorded_at)}</time>` +
    `<name>${escapeXml(`Visit · ${device.name}`)}</name>${description}<type>visit</type></wpt>\n`
  );
}

/**
 * GPX 1.1: the visits as waypoints (which GPX puts before the tracks), then one
 * `<trk>` per device (named after it) with a `<trkseg>` per continuous segment
 * — the same gap rule as the map, so a phone that stopped logging does not get
 * a straight line across the gap. GPX has no notion of Overland's trips.
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
    visits: (device, visits) => visits.map((visit) => waypoint(device, visit)).join(""),
    trips: () => "",
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
