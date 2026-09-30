/**
 * ISO 8601 UTC string for a timestamp from a raw SQL row: Drizzle hands raw
 * query results through as Postgres text (`2026-09-30 19:41:07.123+00`).
 */
export function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Not a timestamp: ${String(value)}`);
  return date.toISOString();
}

export function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}
