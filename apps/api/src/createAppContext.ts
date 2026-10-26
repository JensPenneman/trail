import type { Pool } from "pg";
import type { Logger } from "pino";
import { DatabaseTokenVerifier } from "./apiTokens/databaseTokenVerifier";
import type { AppContext } from "./appContext";
import type { Config } from "./config/config";
import { createDatabase } from "./db/database";
import { EventBus } from "./events/eventBus";
import type { AlertSender } from "./jobs/alert";
import { createNtfySender } from "./jobs/createNtfySender";
import { BackgroundTasks } from "./lib/backgroundTasks";
import { OverpassWaySource, overpassUserAgent } from "./processing/overpassWaySource";
import { processingConfigWith } from "./processing/processingConfig";
import { ProcessingService } from "./processing/processingService";
import type { WaySource } from "./processing/waySource";
import { DailyStatsScheduler } from "./stats/dailyStatsScheduler";
import type { ApiTokenVerifier } from "./v1/apiTokens";

/** The map data source the configuration asks for: Overpass, or none when mapping is off. */
function configuredWaySource(config: Config, logger: Logger): WaySource | null {
  const url = config.processing.overpassUrl;
  if (url === null) return null;
  return new OverpassWaySource({
    url,
    userAgent: overpassUserAgent(config.build.version),
    logger: logger.child({ component: "overpass" }),
  });
}

/**
 * Wires the shared services; tests may inject an alert sender, a token
 * verifier, a map data source and the stats and processing debounces.
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
  return {
    config,
    logger,
    pool,
    db,
    bus,
    dailyStats: new DailyStatsScheduler(db, logger, input.dailyStatsDelayMs),
    background,
    alerts,
    apiTokens: input.apiTokens ?? new DatabaseTokenVerifier(db, background),
    processing: new ProcessingService({
      db,
      logger: logger.child({ component: "processing" }),
      bus,
      config: processingConfigWith(config.processing),
      enabled: config.processing.enabled,
      waySource:
        input.waySource !== undefined ? input.waySource : configuredWaySource(config, logger),
      dailyBytes: config.processing.overpassDailyBytes,
      ...(input.processingDelayMs === undefined ? {} : { delayMs: input.processingDelayMs }),
    }),
  };
}
