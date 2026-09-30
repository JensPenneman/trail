import type { Pool } from "pg";
import type { Logger } from "pino";
import type { AppContext } from "./appContext";
import type { Config } from "./config/config";
import { createDatabase } from "./db/database";
import { EventBus } from "./events/eventBus";
import type { AlertSender } from "./jobs/alert";
import { createNtfySender } from "./jobs/createNtfySender";
import { BackgroundTasks } from "./lib/backgroundTasks";
import { DailyStatsScheduler } from "./stats/dailyStatsScheduler";

/** Wires the shared services; tests may inject an alert sender and a stats debounce. */
export function createAppContext(input: {
  config: Config;
  logger: Logger;
  pool: Pool;
  alerts?: AlertSender | null;
  dailyStatsDelayMs?: number;
}): AppContext {
  const { config, logger, pool } = input;
  const db = createDatabase(pool);
  const alerts =
    input.alerts !== undefined
      ? input.alerts
      : config.alerts === null
        ? null
        : createNtfySender(config.alerts);
  return {
    config,
    logger,
    pool,
    db,
    bus: new EventBus(),
    dailyStats: new DailyStatsScheduler(db, logger, input.dailyStatsDelayMs),
    background: new BackgroundTasks(logger),
    alerts,
  };
}
