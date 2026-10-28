import { hashKey } from "@tanstack/react-query";
import { cacheFormat } from "./cacheFormat";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The query key with every `deviceIds` list sorted: TanStack hashes object
 * keys sorted but arrays in their order, and the device selection hands the
 * hooks ids in whatever order the lists came, so the same devices would make
 * two entries.
 */
export function normalizedQueryKey(queryKey: readonly unknown[]): unknown[] {
  return queryKey.map((part) => {
    if (!isRecord(part)) return part;
    const ids = part["deviceIds"];
    if (!Array.isArray(ids)) return part;
    return { ...part, deviceIds: [...ids].sort() };
  });
}

/** The store's key of a query's answer: the format, the owner, the query. */
export function cacheKey(owner: string, queryKey: readonly unknown[]): string {
  return `${cacheFormat}|${owner}|${hashKey(normalizedQueryKey(queryKey))}`;
}

/**
 * A stored query key as a value of this page: keys are JSON by contract, and
 * an object a structured clone made elsewhere (another realm) is not a plain
 * object to TanStack, which would hash it with its keys unsorted.
 */
export function ownQueryKey(queryKey: readonly unknown[]): unknown[] {
  return JSON.parse(JSON.stringify(queryKey)) as unknown[];
}
