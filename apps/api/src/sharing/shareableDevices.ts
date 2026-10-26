import type { RequestAuth } from "../auth/requestAuth";
import type { Executor } from "../db/database";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";
import { HttpError } from "../http/httpError";

/**
 * A token limited to some devices shares only those, by name: "every device"
 * includes devices the token cannot reach, and those added later. A share
 * that shows other devices is not this token's to widen or extend.
 */
export function assertTokenMayShare(auth: RequestAuth, deviceIds: readonly string[] | null): void {
  if (auth.kind !== "token" || auth.deviceIds === null) return;
  const allowed = new Set(auth.deviceIds);
  if (deviceIds === null) {
    throw new HttpError(
      400,
      "validation_failed",
      "This API token is limited to some devices: list the ones to share.",
      { deviceIds: ["List the devices; this token cannot share every device"] },
    );
  }
  if (!deviceIds.every((deviceId) => allowed.has(deviceId))) {
    throw new HttpError(
      403,
      "forbidden",
      "This share shows devices outside this API token's devices; change it with a session or another token.",
    );
  }
}

/** Every id must be a device of the owner the principal may reach; otherwise 404, as for any id. */
export async function assertOwnDevices(
  db: Executor,
  auth: RequestAuth,
  deviceIds: readonly string[] | null,
): Promise<void> {
  if (deviceIds !== null) await resolveDeviceIds(db, auth, deviceIds);
}
