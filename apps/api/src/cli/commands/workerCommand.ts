import type { Config } from "../../config/config";
import { ConfigError, loadConfig } from "../../config/loadConfig";
import { createLogger } from "../../logging/createLogger";
import { runtimePaths } from "../../runtimePaths";
import { runWorker } from "../../worker/runWorker";

/**
 * `trail worker` — the processing worker in the foreground, the worker
 * service's command (docs/architecture.md §3, §11). Unlike the other commands
 * it is a service: it opens its own pool and logs as the server does, on
 * stdout at LOG_LEVEL, until SIGTERM or SIGINT. Exit code 0 then; 1 on an
 * invalid configuration, in role `api` (a process that must not process) or
 * when it could not start.
 */
export async function workerCommand(entryUrl: string): Promise<number> {
  const paths = runtimePaths(entryUrl);
  let config: Config;
  try {
    config = loadConfig(process.env, { webDistDir: paths.webDistDir });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`trail: ${error.message}`);
    return 1;
  }
  if (config.processing.role === "api") {
    console.error(
      "trail worker: PROCESSING_ROLE is api here, which leaves processing to another process; run the worker where it is worker (or unset)",
    );
    return 1;
  }
  const logger = createLogger({ level: config.logLevel, pretty: config.nodeEnv === "development" });
  return runWorker({ config, logger, migrationsFolder: paths.migrationsFolder });
}
