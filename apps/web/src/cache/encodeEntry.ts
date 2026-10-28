import type { Codec } from "./cacheCodecs";
import type { CacheEntry } from "./cacheEntry";
import { cacheFormat } from "./cacheFormat";
import { cacheKey } from "./cacheKey";
import { devicesOf, periodOf } from "./cachePeriod";
import { maxEntryBytes, policyOf, stampsOf } from "./cachePolicy";
import { isArrayBuffer } from "./pointCodec";

/** The months of the calendar are warm; the 400 days of yearly totals are not. */
const warmDigestMs = 32 * 24 * 60 * 60_000;

/** About what a body takes on disk: its buffers, and the rest as JSON. */
function sizeOf(body: unknown): number {
  let buffers = 0;
  const text = JSON.stringify(body, (_key, value: unknown) => {
    if (isArrayBuffer(value)) {
      buffers += value.byteLength;
      return 0;
    }
    return value;
  });
  return buffers + (text === undefined ? 0 : text.length);
}

export interface EncodeInput {
  owner: string;
  timezone: string;
  queryKey: readonly unknown[];
  answer: unknown;
  fetchedAt: number;
  etag: string | null;
  now: number;
}

/**
 * An answer as the store keeps it, or null when it must not be kept: a query
 * the policy does not list, or an answer over the size of any the contracts
 * allow. Whether it belongs to the warm set is decided here, from what it
 * covers now: the account's devices and settings always, today's tracks and
 * timeline while it is today, the calendar's current month.
 */
export function encodeEntry(
  input: EncodeInput,
  codec: Codec,
): { entry: CacheEntry; body: unknown } | null {
  const policy = policyOf(input.queryKey);
  if (policy === null) return null;
  let body: unknown;
  try {
    body = codec.pack === undefined ? input.answer : codec.pack(input.answer);
  } catch {
    // not the shape its contract promised: nothing worth keeping
    return null;
  }
  const bytes = sizeOf(body);
  if (bytes > maxEntryBytes) return null;
  const period = periodOf(input.queryKey, input.timezone);
  const current = period !== null && period.from <= input.now && input.now < period.until;
  const warm =
    policy.warm === "always" ||
    policy.warm === "latest-device" ||
    (policy.warm === "current" &&
      period !== null &&
      current &&
      (input.queryKey[0] === "days"
        ? period.until - period.from <= warmDigestMs
        : period.day !== null));
  const resource = input.queryKey[0];
  const stamps = policy.stamps === null ? null : (stampsOf(input.answer) ?? null);
  return {
    entry: {
      key: cacheKey(input.owner, input.queryKey),
      format: cacheFormat,
      owner: input.owner,
      scope: { timezone: input.timezone },
      resource: typeof resource === "string" ? resource : "",
      queryKey: [...input.queryKey],
      devices: devicesOf(input.queryKey),
      fetchedAt: input.fetchedAt,
      touchedAt: input.now,
      until: period?.until ?? null,
      expiresAt:
        current && period !== null && policy.todayTtlMs !== null
          ? period.until + policy.todayTtlMs
          : null,
      etag: input.etag,
      stamps: stamps === null ? null : [...stamps],
      warm: warm ? 1 : 0,
      bytes,
    },
    body,
  };
}
