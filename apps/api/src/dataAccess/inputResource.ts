import type { DataAccessResource } from "@trail/contracts/dataAccess";

/** What a path's `{id}` stands for. */
export type PathId = "device" | "segment" | "share" | "link";

const localDay = /^\d{4}-\d{2}-\d{2}$/;

/** A range bound as the log keeps it: a local day as it is, an instant in UTC. */
function bound(value: string): string | undefined {
  if (localDay.test(value)) return value;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

const text = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/**
 * What the validated input of a request names, in the words of the data
 * access log: the devices (`device`, `devices`, `deviceId`, `deviceIds`), the
 * range (`from`, `to`, `at`, `date`, `hours`), the level, precision, mode,
 * format and history — and the path's `{id}` as what it stands for. Nothing
 * else is taken, so a bounding box or a name never reaches the log; the
 * recorder checks every value against the contract once more.
 */
export function inputResource(
  parts: readonly unknown[],
  pathId: PathId | null = null,
): DataAccessResource {
  const resource: { -readonly [K in keyof DataAccessResource]: DataAccessResource[K] } = {};
  const devices: string[] = [];
  for (const part of parts) {
    if (typeof part !== "object" || part === null || Array.isArray(part)) continue;
    const record = part as Record<string, unknown>;
    for (const key of ["device", "deviceId"]) {
      const device = text(record, key);
      if (device !== undefined) devices.push(device);
    }
    devices.push(...strings(record["devices"]), ...strings(record["deviceIds"]));
    for (const key of ["from", "to", "at"] as const) {
      const value = text(record, key);
      const normalised = value === undefined ? undefined : bound(value);
      if (normalised !== undefined && resource[key] === undefined) resource[key] = normalised;
    }
    const date = text(record, "date");
    if (date !== undefined) resource.date ??= date;
    const hours = record["hours"];
    if (typeof hours === "number") resource.hours ??= hours;
    for (const key of ["level", "precision", "format"] as const) {
      const value = text(record, key);
      // The contract checks the value; an unknown one leaves the whole resource out.
      if (value !== undefined && resource[key] === undefined) {
        Object.assign(resource, { [key]: value });
      }
    }
    if ("mode" in record && resource.mode === undefined) {
      const mode = record["mode"];
      if (mode === null || typeof mode === "string") Object.assign(resource, { mode });
    }
    if ("historyDays" in record && resource.historyDays === undefined) {
      const days = record["historyDays"];
      if (days === null || typeof days === "number") resource.historyDays = days;
    }
    const id = text(record, "id");
    if (id !== undefined && pathId !== null) {
      if (pathId === "device") devices.push(id);
      else if (pathId === "segment") resource.segmentId = id;
      else if (pathId === "share") resource.shareId = id;
      else resource.linkId = id;
    }
  }
  if (devices.length > 0) resource.deviceIds = devices;
  return resource;
}
