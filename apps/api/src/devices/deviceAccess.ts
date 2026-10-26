/**
 * Whose devices a lookup may return: the request's principal — an API token may
 * be limited to some of its user's devices — or `{ user: { id } }` for work done
 * on the owner's behalf. Every device lookup takes one, so a token's device
 * restriction cannot get lost on the way to the database.
 */
export interface DeviceAccess {
  user: { id: string };
  /** Only these of the user's devices; absent or null = all of them. */
  deviceIds?: readonly string[] | null;
}

/** The devices `access` is limited to, or null when it may reach every device of the user. */
export const allowedDeviceIds = (access: DeviceAccess): readonly string[] | null =>
  access.deviceIds ?? null;

/**
 * Whether `access` may reach the device; that the user owns it is for the query
 * to check. UUIDs compare without regard to case, as PostgreSQL compares them:
 * `deviceIds` come from the database in lower case, a request may spell an id
 * in capitals.
 */
export function mayReach(access: DeviceAccess, deviceId: string): boolean {
  const allowed = allowedDeviceIds(access);
  return allowed === null || allowed.includes(deviceId.toLowerCase());
}
