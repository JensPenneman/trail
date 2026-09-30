import { type DestinationStream, type Logger, pino } from "pino";
import type { LogLevel } from "../config/config";
import { serializeError } from "./serializeError";

export interface LoggerOptions {
  level: LogLevel;
  /** Human-readable output through pino-pretty (development only; it is a dev dependency). */
  pretty?: boolean;
  /** Defaults to stdout; the CLI logs to stderr so its own output stays clean. */
  destination?: DestinationStream;
}

/** Secrets that must never be written: bearer tokens, cookies, token query parameters. */
const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "req.query.token",
  "req.query.access_token",
];

export function createLogger(options: LoggerOptions): Logger {
  const base = {
    level: options.level,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { err: serializeError, error: serializeError },
    redact: { paths: redactPaths, censor: "[redacted]" },
  };
  if (options.pretty === true) {
    return pino({
      ...base,
      transport: {
        target: "pino-pretty",
        options: { translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" },
      },
    });
  }
  return options.destination === undefined ? pino(base) : pino(base, options.destination);
}
