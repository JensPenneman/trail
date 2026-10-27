import type { TrustProxySetting } from "./config";

/**
 * Turns `TRUST_PROXY` into a value for Express `trust proxy`: `true`/`false`, a
 * hop count, or the comma-separated address/subnet list as-is (Express parses it).
 */
export function parseTrustProxy(value: string): TrustProxySetting {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(", ");
}

/**
 * Whether the setting trusts no proxy at all — `false`, `0` hops or an empty
 * list: then no request can be HTTPS for Express, as Trail serves plain HTTP.
 */
export function trustsNoProxy(setting: TrustProxySetting): boolean {
  return setting === false || setting === 0 || setting === "";
}
