/*
 * Milestone 0 (docs/design/capacity.md §7): production measured on the node on
 * 28 October 2026 — one phone (Overland, high resolution), Postgres 18 with
 * its default settings in the `db` container. Reports set the Mac's numbers
 * beside these; docs/perf/README.md explains them.
 */
export const m0 = {
  measuredOn: "2026-10-28",
  /** `ingest_log.duration_ms` over 7 days by records per upload (ms; ends before COMMIT). */
  uploads: [
    { batch: "<10", from: 0, to: 9, n: null, p50: 8, p95: 13, p99: null, max: null },
    { batch: "10–99", from: 10, to: 99, n: 195, p50: 12, p95: 19, p99: 28, max: 248 },
    { batch: "100–499", from: 100, to: 499, n: 1225, p50: 27, p95: 52, p99: 82, max: 382 },
    {
      batch: "500+",
      from: 500,
      to: Number.POSITIVE_INFINITY,
      n: 7,
      p50: 70,
      p95: 231,
      p99: 253,
      max: null,
    },
  ],
  volume: { uploadsPerDay: [100, 280], pointsPerDay: [23_000, 76_000] },
  /** Bytes a row of the table takes with its indexes (pg_total_relation_size / rows). */
  rowBytes: { locations: 256, processed_points: 320 },
  /** WAL since 23 October: 16 GB, about 3.2 GB a day for one phone (the processing's rewrites). */
  walPerDayGb: 3.2,
  databaseMb: 780,
  /** pg_test_fsync in the `db` container, one 8 kB write. */
  fsync: { open_datasync: 797, fdatasync: 837 },
  hotShare: { devices: 1, daily_stats: 1, heat_cells: 0.92 },
  settings:
    "Postgres defaults: shared_buffers 128 MB, work_mem 4 MB, max_connections 100, wal_compression off, checkpoint_timeout 300 s, synchronous_commit on, random_page_cost 4; pg_stat_statements not installed",
};
