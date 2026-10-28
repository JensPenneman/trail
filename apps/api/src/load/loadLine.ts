import type { IngestTally } from "./ingestMeter";

/** What one minute of the API measured (docs/perf/README.md, "The load line"). */
export interface LoadSample {
  intervalS: number;
  /** Event-loop delay in nanoseconds (`perf_hooks.monitorEventLoopDelay`). */
  eventLoopNs: { p50: number; p99: number; max: number };
  pool: { total: number; idle: number; waiting: number };
  streams: number;
  background: number;
  dailyStatsDays: number;
  ingest: IngestTally;
  memory: { rss: number; heapUsed: number; heapTotal: number };
  /** Null when the queue could not be read (the database is away). */
  processing: { queued: number; ready: number; oldestReadyS: number | null } | null;
}

/** The `load` log line: numbers only — no id, name, token or coordinate can be in it. */
export interface LoadLine {
  intervalS: number;
  loopP50Ms: number;
  loopP99Ms: number;
  loopMaxMs: number;
  poolTotal: number;
  poolIdle: number;
  poolWaiting: number;
  streams: number;
  background: number;
  dailyStatsDays: number;
  uploads: number;
  points: number;
  duplicates: number;
  rejected: number;
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  queueRows: number | null;
  queueReady: number | null;
  queueAgeS: number | null;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
const ms = (ns: number): number => (Number.isFinite(ns) ? round1(ns / 1e6) : 0);
const mb = (bytes: number): number => round1(bytes / 1_048_576);

/** The line of one sample, flat so that `docker logs` and the collector read it as it is. */
export function buildLoadLine(sample: LoadSample): LoadLine {
  const { processing } = sample;
  return {
    intervalS: sample.intervalS,
    loopP50Ms: ms(sample.eventLoopNs.p50),
    loopP99Ms: ms(sample.eventLoopNs.p99),
    loopMaxMs: ms(sample.eventLoopNs.max),
    poolTotal: sample.pool.total,
    poolIdle: sample.pool.idle,
    poolWaiting: sample.pool.waiting,
    streams: sample.streams,
    background: sample.background,
    dailyStatsDays: sample.dailyStatsDays,
    uploads: sample.ingest.uploads,
    points: sample.ingest.points,
    duplicates: sample.ingest.duplicates,
    rejected: sample.ingest.rejected,
    rssMb: mb(sample.memory.rss),
    heapUsedMb: mb(sample.memory.heapUsed),
    heapTotalMb: mb(sample.memory.heapTotal),
    queueRows: processing?.queued ?? null,
    queueReady: processing?.ready ?? null,
    queueAgeS:
      processing === null || processing.oldestReadyS === null
        ? null
        : Math.round(processing.oldestReadyS),
  };
}
