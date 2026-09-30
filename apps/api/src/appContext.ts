import type { Pool } from "pg";
import type { Logger } from "pino";
import type { Config } from "./config/config";
import type { Database } from "./db/database";
import type { EventBus } from "./events/eventBus";
import type { AlertSender } from "./jobs/alert";
import type { BackgroundTasks } from "./lib/backgroundTasks";
import type { DailyStatsScheduler } from "./stats/dailyStatsScheduler";

/** Everything a route or job needs; built once by the entry point (or a test). */
export interface AppContext {
  config: Config;
  logger: Logger;
  pool: Pool;
  db: Database;
  bus: EventBus;
  dailyStats: DailyStatsScheduler;
  background: BackgroundTasks;
  /** Null when no ntfy topic is configured. */
  alerts: AlertSender | null;
}
