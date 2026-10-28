import type { Executor } from "../db/database";
import type { DeviceAccess } from "../devices/deviceAccess";
import { resolveDeviceIds } from "../devices/resolveDeviceIds";
import { loadStampedDays, localDaysOf, type StampedDay } from "./dayStamps";

/**
 * The stamps of an answer about `[from, to)`: every local day the range
 * intersects, of the requested devices the principal reaches (a token limited
 * to some devices gets theirs only; a foreign or unknown id is the 404 the
 * data would be). Called before the data is read (docs/architecture.md §8.9).
 */
export async function stampRange(
  db: Executor,
  access: DeviceAccess & { user: { timezone: string } },
  range: { deviceIds?: readonly string[] | undefined; from: Date; to: Date },
): Promise<{ deviceIds: string[]; days: StampedDay[] }> {
  const deviceIds = (await resolveDeviceIds(db, access, range.deviceIds)).map(
    (device) => device.id,
  );
  const timezone = access.user.timezone;
  const days = await loadStampedDays(db, {
    deviceIds,
    timezone,
    dates: localDaysOf(range, timezone),
  });
  return { deviceIds, days };
}
