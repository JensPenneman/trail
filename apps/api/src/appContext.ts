import type { Pool } from "pg";
import type { Logger } from "pino";
import type { Config } from "./config/config";
import type { DataAccessRecorder } from "./dataAccess/dataAccessRecorder";
import type { Database } from "./db/database";
import type { EventBus } from "./events/eventBus";
import type { AlertSender } from "./jobs/alert";
import type { BackgroundTasks } from "./lib/backgroundTasks";
import type { ProcessingService } from "./processing/processingService";
import type { SharingState } from "./sharing/sharingState";
import type { DailyStatsScheduler } from "./stats/dailyStatsScheduler";
import type { ApiTokenVerifier } from "./v1/apiTokens";

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
  /** Resolves API tokens for `/api/v1`: the `api_tokens` table, or a stand-in in tests. */
  apiTokens: ApiTokenVerifier;
  /** Location processing: averaged, mapped and inferred levels (docs/architecture.md §17). */
  processing: ProcessingService;
  /** The sharing grid key and every owner's shares for the live fan-out (docs/architecture.md §8.5). */
  sharing: SharingState;
  /** Who read or changed whose data: the data access log (docs/architecture.md §8.8). */
  dataAccess: DataAccessRecorder;
}
