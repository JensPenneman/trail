/**
 * The address of an Insights screen with the period and devices of this one:
 * a period chosen on one screen holds on the others.
 */
export function insightsLink(path: string, current: URLSearchParams): string {
  const next = new URLSearchParams();
  for (const key of ["period", "from", "to", "devices"]) {
    const value = current.get(key);
    if (value !== null && value !== "") next.set(key, value);
  }
  const search = next.toString();
  return search === "" ? path : `${path}?${search}`;
}
