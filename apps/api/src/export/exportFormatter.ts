import type { ExportDevice, ExportRow } from "./exportRow";

/** Turns streamed rows into one file format; stateful, one instance per download. */
export interface ExportFormatter {
  contentType: string;
  extension: string;
  begin(): string;
  rows(device: ExportDevice, rows: readonly ExportRow[]): string;
  endDevice(device: ExportDevice): string;
  end(): string;
}
