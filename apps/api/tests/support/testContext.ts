import { createServer, type Server } from "node:http";
import type { DestinationStream } from "pino";
import type { AppContext } from "../../src/appContext";
import type { LogLevel } from "../../src/config/config";
import { loadConfig } from "../../src/config/loadConfig";
import { createAppContext } from "../../src/createAppContext";
import type { DataAccessOptions } from "../../src/dataAccess/dataAccessRecorder";
import { createPool } from "../../src/db/createPool";
import { createApp } from "../../src/http/createApp";
import type { Alert } from "../../src/jobs/alert";
import { createLogger } from "../../src/logging/createLogger";
import type { WaySource } from "../../src/processing/waySource";
import type { ApiTokenVerifier } from "../../src/v1/apiTokens";
import { testEnvironment } from "./testEnvironment";

export interface TestContext {
  ctx: AppContext;
  /** The app on its own HTTP server, listening on 127.0.0.1 (pass it to supertest). */
  app: Server;
  /** Alerts the app tried to send (ntfy is replaced by this list). */
  alerts: Alert[];
  close(): Promise<void>;
}

/**
 * The real app wired to the test database, with an alert recorder and manual
 * flushes of the daily statistics and the processing queue: in role `all`
 * unless `env` sets another (`PROCESSING_ROLE: "api"` beside a worker
 * context, `workerContext.ts`). Passes reach its bus through the processing
 * channel, listened to before it resolves. It listens on 127.0.0.1 itself:
 * supertest would listen on the `::` wildcard and then connect to
 * 127.0.0.1:<port>, and on macOS another local process may hold that port on
 * 127.0.0.1 and receive the request instead.
 */
export async function createTestContext(
  options: {
    env?: Record<string, string>;
    webDistDir?: string;
    /** Receives the app's log lines instead of discarding them … */
    logDestination?: DestinationStream;
    /** … from this level on (info by default). */
    logLevel?: LogLevel;
    /** Resolves API tokens on /api/v1 instead of the `api_tokens` table (a stand-in for every outcome). */
    apiTokens?: ApiTokenVerifier;
    /** Map data for processing (default: none, so the mapped level degrades to averaged). */
    waySource?: WaySource | null;
    /** The data access log's limits; tests read its rows after `ctx.dataAccess.flush()`. */
    dataAccess?: DataAccessOptions;
  } = {},
): Promise<TestContext> {
  const config = loadConfig(testEnvironment(options.env), {
    webDistDir: options.webDistDir ?? "/nonexistent/web/dist",
  });
  const logger =
    options.logDestination === undefined
      ? createLogger({ level: "silent" })
      : createLogger({ level: options.logLevel ?? "info", destination: options.logDestination });
  const pool = createPool(config.databaseUrl, logger, { statementTimeoutMs: 30_000, max: 5 });
  const alerts: Alert[] = [];
  const ctx = createAppContext({
    config,
    logger,
    pool,
    alerts: async (alert) => {
      alerts.push(alert);
    },
    ...(options.apiTokens === undefined ? {} : { apiTokens: options.apiTokens }),
    // Tests flush the daily statistics and the processing queue explicitly.
    dailyStatsDelayMs: 3_600_000,
    processingDelayMs: 3_600_000,
    waySource: options.waySource ?? null,
    ...(options.dataAccess === undefined ? {} : { dataAccess: options.dataAccess }),
  });
  await ctx.processingListener.start();
  const server = createServer(createApp(ctx));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return {
    ctx,
    app: server,
    alerts,
    async close() {
      ctx.bus.disconnectAll();
      await ctx.processingListener.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      ctx.dailyStats.stop();
      await ctx.background.drain(5_000);
      await ctx.processing.stop();
      await ctx.dataAccess.flush();
      ctx.dataAccess.stop();
      await pool.end();
    },
  };
}
