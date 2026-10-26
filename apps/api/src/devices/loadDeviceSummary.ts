import type { DeviceSummary } from "@trail/contracts/device";
import type { Executor } from "../db/database";
import { notFound } from "../http/httpError";
import { isUuid } from "../lib/isUuid";
import { type DeviceAccess, mayReach } from "./deviceAccess";
import { loadDeviceSummaries } from "./loadDeviceSummaries";

/** One device summary, or 404 when the principal may not reach it (or it does not exist). */
export async function loadDeviceSummary(
  db: Executor,
  access: DeviceAccess,
  deviceId: string,
): Promise<DeviceSummary> {
  if (!isUuid(deviceId) || !mayReach(access, deviceId)) throw notFound("No such device.");
  const [summary] = await loadDeviceSummaries(db, access, deviceId);
  if (summary === undefined) throw notFound("No such device.");
  return summary;
}
