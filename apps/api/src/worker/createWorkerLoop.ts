import type { Logger } from "pino";
import type { Config } from "../config/config";
import type { Database } from "../db/database";
import { OverpassWaySource, overpassUserAgent } from "../processing/overpassWaySource";
import { processingConfigWith } from "../processing/processingConfig";
import { ProcessingWorker } from "../processing/processingWorker";
import { TileFetcher } from "../processing/tileFetcher";
import type { WaySource } from "../processing/waySource";
import { WorkerLoop } from "./workerLoop";

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
 * A worker as the configuration describes it (docs/architecture.md §3): the
 * processing worker with its map tile fetcher — none with processing switched
 * off — and the heartbeat. `pollReady` where no upload wakes it, in a worker
 * process; tests inject a map data source and the debounce after new work.
 */
export function createWorkerLoop(input: {
  config: Config;
  logger: Logger;
  db: Database;
  pollReady: boolean;
  waySource?: WaySource | null;
  delayMs?: number;
}): WorkerLoop {
  const { config, db } = input;
  const settings = config.processing;
  const logger = input.logger.child({ component: "processing" });
  let processing: ProcessingWorker | null = null;
  if (settings.enabled) {
    const processingConfig = processingConfigWith(settings);
    const waySource =
      input.waySource !== undefined ? input.waySource : configuredWaySource(config, input.logger);
    processing = new ProcessingWorker({
      db,
      logger,
      config: processingConfig,
      fetcher:
        waySource === null
          ? null
          : new TileFetcher({
              db,
              logger,
              source: waySource,
              dailyBytes: settings.overpassDailyBytes,
              maxAgeDays: processingConfig.mapping.tileMaxAgeDays,
            }),
      ...(input.delayMs === undefined ? {} : { delayMs: input.delayMs }),
    });
  }
  return new WorkerLoop({
    db,
    logger,
    processing,
    version: config.build.version,
    pollReady: input.pollReady,
  });
}
