import { DrizzleQueryError } from "drizzle-orm";

/* Postgres puts the failing row into `detail`/`where`, and Drizzle puts every
 * query parameter into its error message — both can hold coordinates or other
 * personal data, which must never reach the logs above debug level. */
const droppedKeys = new Set([
  "detail",
  "where",
  "internalQuery",
  "params",
  "query",
  "cause",
  "raw",
]);

const stackFrames = (stack: string | undefined): string =>
  (stack ?? "")
    .split("\n")
    .filter((line) => line.trimStart().startsWith("at "))
    .join("\n");

/* pino-http runs pino's standard serializer first and passes its result, which
 * keeps the original error in a non-enumerable `raw`. */
const originalError = (value: unknown): unknown => {
  if (value instanceof Error) return value;
  if (typeof value === "object" && value !== null && "raw" in value && value.raw instanceof Error) {
    return value.raw;
  }
  return value;
};

/** pino `err` serializer that keeps codes, messages and stacks but never query parameters. */
export function serializeError(value: unknown): unknown {
  const error = originalError(value);
  if (!(error instanceof Error)) return error;
  const message =
    error instanceof DrizzleQueryError ? `Failed query: ${error.query}` : error.message;
  const serialized: Record<string, unknown> = {
    type: error.constructor.name,
    message,
    stack: `${error.constructor.name}: ${message}\n${stackFrames(error.stack)}`,
  };
  for (const [key, entry] of Object.entries(error)) {
    if (droppedKeys.has(key)) continue;
    if (entry === null || ["string", "number", "boolean"].includes(typeof entry)) {
      serialized[key] = entry;
    }
  }
  if (error.cause !== undefined) serialized["cause"] = serializeError(error.cause);
  return serialized;
}
