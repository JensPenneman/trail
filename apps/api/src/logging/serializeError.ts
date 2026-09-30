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

/* A Postgres error message can quote the value it refused ("invalid input syntax for
 * type double precision: …"): of those only the fields that name what failed are kept. */
const postgresKeys = new Set([
  "code",
  "severity",
  "routine",
  "constraint",
  "schema",
  "table",
  "column",
  "dataType",
]);

/** An error sent by the Postgres server (pg's DatabaseError), recognised by its fields. */
const isPostgresError = (error: Error): boolean =>
  "routine" in error &&
  "severity" in error &&
  "code" in error &&
  typeof error.code === "string" &&
  /^[0-9A-Z]{5}$/.test(error.code);

const messageOf = (error: Error): string => {
  if (error instanceof DrizzleQueryError) return `Failed query: ${error.query}`;
  if (isPostgresError(error) && "code" in error) return `Postgres error ${String(error.code)}`;
  return error.message;
};

/** pino `err` serializer that keeps codes, messages and stacks but never query parameters. */
export function serializeError(value: unknown): unknown {
  const error = originalError(value);
  if (!(error instanceof Error)) return error;
  const message = messageOf(error);
  const fromPostgres = isPostgresError(error);
  const serialized: Record<string, unknown> = {
    type: error.constructor.name,
    message,
    stack: `${error.constructor.name}: ${message}\n${stackFrames(error.stack)}`,
  };
  for (const [key, entry] of Object.entries(error)) {
    if (droppedKeys.has(key) || (fromPostgres && !postgresKeys.has(key))) continue;
    if (entry === null || ["string", "number", "boolean"].includes(typeof entry)) {
      serialized[key] = entry;
    }
  }
  if (error.cause !== undefined) serialized["cause"] = serializeError(error.cause);
  return serialized;
}
