import type { RangeParams } from "../api/queryKeys";

/** Recognises the parameter object in a `["tracks", params]` query key. */
export function isRangeParams(value: unknown): value is RangeParams {
  if (typeof value !== "object" || value === null) return false;
  if (!("from" in value) || !("to" in value) || !("deviceIds" in value)) return false;
  return (
    typeof value.from === "string" &&
    typeof value.to === "string" &&
    (value.deviceIds === null || Array.isArray(value.deviceIds))
  );
}
