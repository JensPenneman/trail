import type { DeviceSummary } from "@trail/contracts/device";
import type { Executor } from "../db/database";
import type { DeviceAccess } from "../devices/deviceAccess";
import { loadDeviceSummaries } from "../devices/loadDeviceSummaries";
import { loadDeviceSummary } from "../devices/loadDeviceSummary";
import { type OwnedDevice, resolveDeviceIds } from "../devices/resolveDeviceIds";
import { HttpError, notFound } from "../http/httpError";
import { isUuid } from "../lib/isUuid";

/* The same answer for an unknown id, someone else's and one outside the
 * token's devices: nothing to probe. It never repeats what was asked for. */
const noSuchDevice = (): HttpError =>
  notFound("No such device. list_devices names the devices this token reaches.");

const ambiguousName = (): HttpError =>
  new HttpError(
    400,
    "validation_failed",
    "Several devices have this name. Pass the device's id from list_devices instead.",
  );

const sameName = (a: string, b: string): boolean =>
  a.normalize("NFC").trim() === b.normalize("NFC").trim();

/** Most recent position first; devices without one last, the most recent upload first among them. */
function byNewestPosition(a: DeviceSummary, b: DeviceSummary): number {
  const position = (summary: DeviceSummary) =>
    summary.lastLocation === null ? -1 : Date.parse(summary.lastLocation.recordedAt);
  const seen = (summary: DeviceSummary) =>
    summary.lastSeenAt === null ? -1 : Date.parse(summary.lastSeenAt);
  return position(b) - position(a) || seen(b) - seen(a);
}

/**
 * The device a tool is asked about (`device`): an id, or the exact name of
 * exactly one device the principal reaches; without one, the device that
 * reported a position most recently. Unknown, foreign and withheld devices
 * all answer the same 404, and a token limited to some devices never
 * resolves another one, by id or by name.
 */
export async function chooseDevice(
  db: Executor,
  access: DeviceAccess,
  device: string | undefined,
): Promise<DeviceSummary> {
  if (device !== undefined && isUuid(device)) {
    try {
      return await loadDeviceSummary(db, access, device);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) throw noSuchDevice();
      throw error;
    }
  }
  const summaries = await loadDeviceSummaries(db, access);
  if (device === undefined) {
    const [newest] = [...summaries].sort(byNewestPosition);
    if (newest === undefined) throw notFound("This token reaches no device.");
    return newest;
  }
  const named = summaries.filter((summary) => sameName(summary.name, device));
  if (named.length > 1) throw ambiguousName();
  const [only] = named;
  if (only === undefined) throw noSuchDevice();
  return only;
}

/**
 * The devices a range tool covers: the one asked for — by id or by exact
 * name, as `chooseDevice` — or every device the principal reaches.
 */
export async function chooseDevices(
  db: Executor,
  access: DeviceAccess,
  device: string | undefined,
): Promise<OwnedDevice[]> {
  if (device !== undefined && isUuid(device)) {
    try {
      return await resolveDeviceIds(db, access, [device]);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) throw noSuchDevice();
      throw error;
    }
  }
  const reachable = await resolveDeviceIds(db, access, undefined);
  if (device === undefined) return reachable;
  const named = reachable.filter((candidate) => sameName(candidate.name, device));
  if (named.length > 1) throw ambiguousName();
  if (named.length === 0) throw noSuchDevice();
  return named;
}
