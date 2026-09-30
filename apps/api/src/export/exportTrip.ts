/** One finished trip as the export reads it (raw row: timestamps are Postgres text). */
export interface ExportTrip extends Record<string, unknown> {
  started_at: string;
  ended_at: string;
  mode: string;
  distance_m: number | null;
  duration_s: number | null;
  steps: number | null;
  stopped_automatically: boolean;
  start_location: unknown;
  end_location: unknown;
  extra: Record<string, unknown> | null;
}
