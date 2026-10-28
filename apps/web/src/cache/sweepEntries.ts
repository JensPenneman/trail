import type { CacheEntry } from "./cacheEntry";
import { cacheFormat } from "./cacheFormat";
import { maxEntryBytes, policyOf } from "./cachePolicy";
import { isExpired } from "./decodeEntry";

const evictionRank = { settled: 0, insights: 1, other: 2 } as const;

/**
 * Whether an entry is never removed to make room: the warm set while what it
 * covers is current — the account's devices and settings, today's tracks and
 * timeline, the calendar's current month, the modes of the devices.
 */
export function isProtected(entry: CacheEntry, now: number): boolean {
  return entry.warm === 1 && (entry.until === null || entry.until > now);
}

export interface SweepInput {
  entries: readonly CacheEntry[];
  /** The owner the store holds; entries of anyone else go. */
  owner: string | null;
  now: number;
  /** Removes what is least needed until the rest is under this. */
  targetBytes: number;
}

export interface SweepResult {
  remove: string[];
  /** What stays. */
  bytes: number;
}

/**
 * Which entries go (docs/architecture.md §14): those of another format or
 * owner, those past their TTL, any over the size cap, the heat views beyond
 * the newest twenty; then, while the rest is over `targetBytes`, least
 * recently touched first, settled days and ranges, then Insights, then the
 * rest — never the warm set, never today.
 */
export function sweepEntries({ entries, owner, now, targetBytes }: SweepInput): SweepResult {
  const remove: string[] = [];
  const kept: CacheEntry[] = [];
  for (const entry of entries) {
    const policy = policyOf(entry.queryKey);
    const gone =
      entry.format !== cacheFormat ||
      entry.owner !== owner ||
      policy === null ||
      isExpired(entry, policy, now) ||
      entry.bytes > maxEntryBytes;
    if (gone) remove.push(entry.key);
    else kept.push(entry);
  }

  // At most `maxEntries` of a resource, the most recently touched.
  const newestFirst = [...kept].sort((a, b) => b.touchedAt - a.touchedAt);
  const counts = new Map<string, number>();
  const withinLimits: CacheEntry[] = [];
  for (const entry of newestFirst) {
    const limit = policyOf(entry.queryKey)?.maxEntries ?? null;
    const count = (counts.get(entry.resource) ?? 0) + 1;
    counts.set(entry.resource, count);
    if (limit !== null && count > limit && !isProtected(entry, now)) remove.push(entry.key);
    else withinLimits.push(entry);
  }

  let bytes = withinLimits.reduce((sum, entry) => sum + entry.bytes, 0);
  if (bytes > targetBytes) {
    const candidates = withinLimits
      .filter((entry) => !isProtected(entry, now))
      .sort((a, b) => {
        const rank = (entry: CacheEntry) =>
          evictionRank[policyOf(entry.queryKey)?.eviction ?? "other"];
        return rank(a) - rank(b) || a.touchedAt - b.touchedAt;
      });
    for (const entry of candidates) {
      if (bytes <= targetBytes) break;
      remove.push(entry.key);
      bytes -= entry.bytes;
    }
  }
  return { remove, bytes };
}
