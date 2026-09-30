/**
 * The IANA zones the browser knows, grouped by region for a `<select>`. The
 * current value is always included (runtimes differ in which aliases they
 * list, e.g. UTC or Europe/Kyiv versus Europe/Kiev).
 */
export function timeZoneOptions(current: string): { region: string; zones: string[] }[] {
  let zones: string[];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  const all = new Set([...zones, current, "UTC"]);
  const groups = new Map<string, string[]>();
  for (const zone of [...all].sort()) {
    const region = zone.includes("/") ? (zone.split("/")[0] ?? "Other") : "Other";
    const list = groups.get(region) ?? [];
    list.push(zone);
    groups.set(region, list);
  }
  return [...groups.entries()].map(([region, list]) => ({ region, zones: list }));
}
