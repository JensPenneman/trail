/**
 * `table[key]` for a key that came from outside — a phone, OpenStreetMap, the
 * command line: the table's own entries only, never what every object
 * inherits, which `constructor`, `toString` or `__proto__` would find.
 */
export function ownEntry<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}
