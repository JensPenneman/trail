import type { ExportDevice, ExportRow } from "./exportRow";
import type { ExportTrip } from "./exportTrip";
import type { ExportVisit } from "./exportVisit";

/**
 * Turns an export into one file format; stateful, one instance per download.
 * The visits and trips of every device come first (GPX wants its waypoints
 * before the tracks), then each device's points stream in pages.
 */
export interface ExportFormatter {
  contentType: string;
  extension: string;
  begin(): string;
  visits(device: ExportDevice, visits: readonly ExportVisit[]): string;
  trips(device: ExportDevice, trips: readonly ExportTrip[]): string;
  rows(device: ExportDevice, rows: readonly ExportRow[]): string;
  endDevice(device: ExportDevice): string;
  end(): string;
}
