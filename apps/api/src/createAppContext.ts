import type { Pool } from "pg";
import type { Logger } from "pino";
import { DatabaseTokenVerifier } from "./apiTokens/databaseTokenVerifier";
import type { AppContext } from "./appContext";
import type { Config } from "./config/config";
import { tableAccessStore } from "./dataAccess/accessStore";
import { type DataAccessOptions, DataAccessRecorder } from "./dataAccess/dataAccessRecorder";
import { createDatabase } from "./db/database";
import { EventBus } from "./events/eventBus";
import { ProcessingListener } from "./events/processingListener";
import type { AlertSender } from "./jobs/alert";
import { createNtfySender } from "./jobs/createNtfySender";
import { BackgroundTasks } from "./lib/backgroundTasks";
import { IngestMeter } from "./load/ingestMeter";
import { processingConfigWith } from "./processing/processingConfig";
import { ProcessingService } from "./processing/processingService";
import type { WaySource } from "./processing/waySource";
import { SharingState } from "./sharing/sharingState";
import { DailyStatsScheduler } from "./stats/dailyStatsScheduler";
import type { ApiTokenVerifier } from "./v1/apiTokens";
import { createWorkerLoop } from "./worker/createWorkerLoop";

/**
 * Wires the shared services of the API; in role `all` the processing worker
 * too (docs/architecture.md §3). Tests may inject an alert sender, a token
 * verifier, a map data source, the stats and processing debounces and the
 * data access log's limits.
 */
export function createAppContext(input: {
  config: Config;
  logger: Logger;
  pool: Pool;
  alerts?: AlertSender | null;
  apiTokens?: ApiTokenVerifier;
  dailyStatsDelayMs?: number;
  waySource?: WaySource | null;
  processingDelayMs?: number;
  dataAccess?: DataAccessOptions;
}): AppContext {
  const { config, logger, pool } = input;
  const db = createDatabase(pool);
  const bus = new EventBus();
  const alerts =
    input.alerts !== undefined
      ? input.alerts
      : config.alerts === null
        ? null
        : createNtfySender(config.alerts);
  const background = new BackgroundTasks(logger);
  const settings = config.processing;
  // Role `all` works the queue out in this process; in role `api` a worker process does.
  const worker =
    settings.role === "all" && settings.enabled
      ? createWorkerLoop({
          config,
          logger,
          db,
          pollReady: false,
          ...(input.waySource === undefined ? {} : { waySource: input.waySource }),
          ...(input.processingDelayMs === undefined ? {} : { delayMs: input.processingDelayMs }),
        })
      : null;
  return {
    config,
    logger,
    pool,
    db,
    bus,
    dailyStats: new DailyStatsScheduler(db, logger, input.dailyStatsDelayMs),
    background,
    ingestMeter: new IngestMeter(),
    alerts,
    apiTokens: input.apiTokens ?? new DatabaseTokenVerifier(db, background),
    processing: new ProcessingService({
      db,
      logger: logger.child({ component: "processing" }),
      config: processingConfigWith(settings),
      enabled: settings.enabled,
      worker,
    }),
    processingListener: new ProcessingListener({
      connectionString: config.databaseUrl,
      bus,
      logger: logger.child({ component: "processing-events" }),
    }),
    sharing: new SharingState(db),
    dataAccess: new DataAccessRecorder(
      tableAccessStore(db),
      logger.child({ component: "data-access" }),
      input.dataAccess,
    ),
  };
}
