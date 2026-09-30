/** One visit as the export reads it (raw row: timestamps are Postgres text). */
export interface ExportVisit extends Record<string, unknown> {
  recorded_at: string;
  arrived_at: string | null;
  departed_at: string | null;
  lat: number;
  lon: number;
  horizontal_accuracy: number | null;
  extra: Record<string, unknown> | null;
}
