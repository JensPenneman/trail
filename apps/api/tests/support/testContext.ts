import { createServer, type Server } from "node:http";
import type { DestinationStream } from "pino";
import type { AppContext } from "../../src/appContext";
import { loadConfig } from "../../src/config/loadConfig";
import { createAppContext } from "../../src/createAppContext";
import { createPool } from "../../src/db/createPool";
import { createApp } from "../../src/http/createApp";
import type { Alert } from "../../src/jobs/alert";
import { createLogger } from "../../src/logging/createLogger";
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
 * The real app wired to the test database, with an alert recorder and a
 * manual daily-stats flush. It listens on 127.0.0.1 itself: supertest would
 * listen on the `::` wildcard and then connect to 127.0.0.1:<port>, and on
 * macOS another local process may hold that port on 127.0.0.1 and receive the
 * request instead.
 */
export async function createTestContext(
  options: {
    env?: Record<string, string>;
    webDistDir?: string;
    /** Receives the app's log lines (level info) instead of discarding them. */
    logDestination?: DestinationStream;
  } = {},
): Promise<TestContext> {
  const config = loadConfig(testEnvironment(options.env), {
    webDistDir: options.webDistDir ?? "/nonexistent/web/dist",
  });
  const logger =
    options.logDestination === undefined
      ? createLogger({ level: "silent" })
      : createLogger({ level: "info", destination: options.logDestination });
  const pool = createPool(config.databaseUrl, logger, { statementTimeoutMs: 30_000, max: 5 });
  const alerts: Alert[] = [];
  const ctx = createAppContext({
    config,
    logger,
    pool,
    alerts: async (alert) => {
      alerts.push(alert);
    },
    // Tests flush the daily statistics explicitly.
    dailyStatsDelayMs: 3_600_000,
  });
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
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      ctx.dailyStats.stop();
      await ctx.background.drain(5_000);
      await pool.end();
    },
  };
}
