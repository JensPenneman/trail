import { storableText } from "./storableText";

/** Nothing Overland sends nests this deep; unbounded nesting would only exhaust the stack. */
const maxDepth = 16;

/**
 * A JSON value Postgres accepts as `jsonb`, for everything stored as the phone
 * sent it (`extra`, trip locations, the dead letter): every string and key
 * through `storableText`, non-finite numbers as null, and anything nested
 * deeper than `maxDepth` levels replaced by null.
 */
export function storableJson(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return storableText(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || typeof value === "boolean") return value;
  if (depth >= maxDepth || typeof value !== "object") return null;
  if (Array.isArray(value)) return value.map((item: unknown) => storableJson(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [storableText(key), storableJson(item, depth + 1)]),
  );
}
