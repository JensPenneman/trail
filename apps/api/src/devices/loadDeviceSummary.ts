import type { DeviceSummary } from "@trail/contracts/device";
import type { Executor } from "../db/database";
import { notFound } from "../http/httpError";
import { isUuid } from "../lib/isUuid";
import { loadDeviceSummaries } from "./loadDeviceSummaries";

/** One device summary of the user, or 404 when it does not exist or belongs to someone else. */
export async function loadDeviceSummary(
  db: Executor,
  userId: string,
  deviceId: string,
): Promise<DeviceSummary> {
  if (!isUuid(deviceId)) throw notFound("No such device.");
  const [summary] = await loadDeviceSummaries(db, { userId, deviceId });
  if (summary === undefined) throw notFound("No such device.");
  return summary;
}
