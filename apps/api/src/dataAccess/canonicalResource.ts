import { type DataAccessResource, dataAccessResourceSchema } from "@trail/contracts/dataAccess";

/**
 * A resource as it is stored and compared: through the contract — keys it
 * does not name are dropped, every value is checked, so no coordinate and no
 * free text can get in — with its keys in order and its devices sorted, so
 * the same data reads as the same resource. Null when a value is invalid.
 */
export function canonicalResource(resource: DataAccessResource): DataAccessResource | null {
  const parsed = dataAccessResourceSchema.safeParse(resource);
  if (!parsed.success) return null;
  const entries = Object.entries(parsed.data)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]): [string, unknown] =>
      key === "deviceIds" && Array.isArray(value)
        ? [key, [...new Set(value)].sort()]
        : [key, value],
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries);
}
