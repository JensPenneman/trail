import type { Codec } from "./cacheCodecs";
import type { CacheEntry } from "./cacheEntry";
import { cacheFormat } from "./cacheFormat";
import { policyOf, type ResourcePolicy } from "./cachePolicy";

/** Why an entry was not handed out: it is deleted for each of these. */
type DecodeFailure = "format" | "owner" | "zone" | "expired" | "unlisted" | "damaged" | "schema";

export type Decoded = { ok: true; answer: unknown } | { ok: false; failure: DecodeFailure };

/** Whether an entry outlived its TTL: untouched for too long, or an answer about a day long gone. */
export function isExpired(entry: CacheEntry, policy: ResourcePolicy, now: number): boolean {
  if (entry.expiresAt !== null && now > entry.expiresAt) return true;
  return now - entry.touchedAt > policy.ttlMs;
}

/**
 * An entry as the app would have had it from `apiFetch`, or why not: written
 * by another version of the store, for another account or time zone, past its
 * TTL, of a resource the policy no longer lists, damaged (the packed numbers
 * are not what the codec made), or no longer what the contract allows. The
 * packed tuples are restored first and the contract's schema runs on the
 * result, so a copy is checked exactly like an answer.
 */
export function decodeEntry(
  entry: CacheEntry,
  body: unknown,
  expected: { owner: string; timezone: string; now: number },
  codec: Codec | null,
): Decoded {
  if (entry.format !== cacheFormat) return { ok: false, failure: "format" };
  if (entry.owner !== expected.owner) return { ok: false, failure: "owner" };
  const policy = policyOf(entry.queryKey);
  if (policy === null) return { ok: false, failure: "unlisted" };
  if (policy.zoned && entry.scope.timezone !== expected.timezone) {
    return { ok: false, failure: "zone" };
  }
  if (isExpired(entry, policy, expected.now)) return { ok: false, failure: "expired" };
  if (codec === null) return { ok: false, failure: "unlisted" };
  let unpacked: unknown;
  try {
    unpacked = codec.unpack === undefined ? body : codec.unpack(body);
  } catch {
    return { ok: false, failure: "damaged" };
  }
  if (unpacked === null || unpacked === undefined) return { ok: false, failure: "damaged" };
  const parsed = codec.schema.safeParse(unpacked);
  return parsed.success ? { ok: true, answer: parsed.data } : { ok: false, failure: "schema" };
}
