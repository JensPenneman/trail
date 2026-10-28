import type { QueryClient } from "@tanstack/react-query";
import type { DeviceListResponse } from "@trail/contracts/device";
import type { Codec } from "./cacheCodecs";
import { ownQueryKey } from "./cacheKey";
import { cacheValidators } from "./cacheValidators";
import { decodeEntry } from "./decodeEntry";
import type { StoredEntry } from "./openCacheStore";
import { isProtected } from "./sweepEntries";

export interface WarmRestore {
  /** Entries put into the query cache, and their bytes. */
  restored: number;
  bytes: number;
  /** Keys of entries that failed (another format, owner or zone, damaged, refused by the contract). */
  invalid: string[];
  /** Keys of entries past their TTL. */
  expired: string[];
  /** The answers restored, by key, so that writing them back is a touch. */
  answers: Map<string, unknown>;
}

/** The device that reported last, whose mode the Me card shows. */
function latestDevice(devices: DeviceListResponse | undefined): string | null {
  let latest: { id: string; at: number } | null = null;
  for (const device of devices?.devices ?? []) {
    const at =
      device.lastSeenAt === null ? Number.NEGATIVE_INFINITY : Date.parse(device.lastSeenAt);
    if (latest === null || at > latest.at) latest = { id: device.id, at };
  }
  return latest?.id ?? null;
}

/**
 * Puts the warm set into the query cache before the first paint: the
 * account's devices and settings, today's tracks, levels and timeline, the
 * calendar's current month and the mode of the device that reported last —
 * each checked like any answer (decodeEntry), with the time it was fetched,
 * so that freshness says how old it is, and marked stale: the pages show it at
 * once and ask for it again. An answer already in the cache that is as new
 * or newer stays. Runs only once the session probe named the owner.
 */
export function restoreWarmSet(
  client: QueryClient,
  stored: readonly StoredEntry[],
  expected: { owner: string; timezone: string; now: number },
  codecs: ReadonlyMap<string, Codec | null>,
): WarmRestore {
  const result: WarmRestore = {
    restored: 0,
    bytes: 0,
    invalid: [],
    expired: [],
    answers: new Map(),
  };
  const decoded: { stored: StoredEntry; answer: unknown }[] = [];
  for (const candidate of stored) {
    if (!isProtected(candidate.entry, expected.now)) continue;
    const codec = codecs.get(candidate.entry.key) ?? null;
    const outcome = decodeEntry(candidate.entry, candidate.body, expected, codec);
    if (outcome.ok) decoded.push({ stored: candidate, answer: outcome.answer });
    else if (outcome.failure === "expired") result.expired.push(candidate.entry.key);
    else result.invalid.push(candidate.entry.key);
  }
  const devices = decoded.find(({ stored: { entry } }) => entry.resource === "devices");
  const latest = latestDevice(devices?.answer as DeviceListResponse | undefined);
  for (const { stored: candidate, answer } of decoded) {
    const { entry } = candidate;
    if (entry.resource === "device-mode" && entry.queryKey[1] !== latest) continue;
    const queryKey = ownQueryKey(entry.queryKey);
    const existing = client.getQueryState(queryKey);
    if (existing?.data !== undefined && existing.dataUpdatedAt >= entry.fetchedAt) continue;
    client.setQueryData(queryKey, answer, { updatedAt: entry.fetchedAt });
    // From another page load: shown at once, asked for again as soon as a page shows it.
    client.getQueryCache().find({ queryKey, exact: true })?.invalidate();
    cacheValidators.set(client, queryKey, entry.etag);
    result.answers.set(entry.key, answer);
    result.restored += 1;
    result.bytes += entry.bytes;
  }
  return result;
}
