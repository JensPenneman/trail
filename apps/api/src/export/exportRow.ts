/** One stored point as the export reads it (raw row: timestamps are Postgres text). */
export interface ExportRow extends Record<string, unknown> {
  recorded_at: string;
  received_at: string;
  epoch: number;
  lat: number;
  lon: number;
  altitude: number | null;
  speed: number | null;
  course: number | null;
  horizontal_accuracy: number | null;
  vertical_accuracy: number | null;
  speed_accuracy: number | null;
  course_accuracy: number | null;
  motion: string[];
  battery_level: number | null;
  battery_state: string | null;
  wifi: string | null;
  extra: Record<string, unknown> | null;
}

/** The device a row belongs to, as named in the export. */
export interface ExportDevice {
  id: string;
  name: string;
  deviceKey: string;
}
