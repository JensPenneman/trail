import type { Logger } from "pino";

/** express-rate-limit reports misconfiguration through this instead of the console. */
export function rateLimitLogger(logger: Logger) {
  return {
    error: (error: unknown, message?: string) => {
      logger.error({ err: error }, message ?? "rate limiter error");
    },
    warn: (error: unknown, message?: string) => {
      logger.warn({ err: error }, message ?? "rate limiter warning");
    },
  };
}
