import type { RequestAuth } from "../auth/requestAuth";
import type { Executor } from "../db/database";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";
import { HttpError } from "../http/httpError";

const limitedTo = (auth: RequestAuth): ReadonlySet<string> | null =>
  auth.kind === "token" && auth.deviceIds !== null ? new Set(auth.deviceIds) : null;

/**
 * The devices a request asks to share: each must be a device of the owner the
 * principal may reach (otherwise 404, as for any id). A token limited to some
 * devices must list them: "every device" includes devices it cannot reach,
 * and the ones added later.
 */
export async function assertShareableDevices(
  db: Executor,
  auth: RequestAuth,
  deviceIds: readonly string[] | null,
): Promise<void> {
  if (deviceIds === null) {
    if (limitedTo(auth) === null) return;
    throw new HttpError(
      400,
      "validation_failed",
      "This API token is limited to some devices: list the ones to share.",
      { deviceIds: ["List the devices; this token cannot share every device"] },
    );
  }
  await resolveDeviceIds(db, auth, deviceIds);
}

/**
 * A token limited to some devices changes only shares that show nothing but
 * those devices: anything else would widen or extend what other devices show.
 * Stopping a share is always allowed.
 */
export function assertWithinTokenDevices(
  auth: RequestAuth,
  deviceIds: readonly string[] | null,
): void {
  const allowed = limitedTo(auth);
  if (allowed === null) return;
  if (deviceIds?.every((deviceId) => allowed.has(deviceId)) === true) return;
  throw new HttpError(
    403,
    "forbidden",
    "This share shows devices outside this API token's devices; change it with a session or another token.",
  );
}
