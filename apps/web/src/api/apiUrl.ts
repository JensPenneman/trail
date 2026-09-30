export type QueryValue = string | number | boolean | readonly string[] | null | undefined;

/**
 * Appends query parameters to an API path. Empty values are left out so an
 * omitted filter means "all" to the server; lists are comma-joined as the
 * contract's `deviceIds` parameter expects.
 */
export function apiUrl(path: string, query?: Readonly<Record<string, QueryValue>>): string {
  if (query === undefined) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(","));
      continue;
    }
    params.set(key, String(value));
  }
  const search = params.toString();
  return search === "" ? path : `${path}?${search}`;
}
