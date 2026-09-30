import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import type { Logger } from "pino";
import type { Database } from "../db/database";
import { devices } from "../db/schema/devices";
import { users } from "../db/schema/users";
import type { AlertSender } from "./alert";
import { silentDeviceAlert } from "./alertMessages";

/**
 * Alerts once for every device (with alerts on) that has been silent longer
 * than `staleAfterHours`. The device is only marked alerted after the message
 * was delivered, so an unreachable ntfy is retried on the next run.
 */
export async function checkSilentDevices(input: {
  db: Database;
  logger: Logger;
  alerts: AlertSender;
  staleAfterHours: number;
  now?: Date;
}): Promise<number> {
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - input.staleAfterHours * 3_600_000);
  const silent = await input.db
    .select({
      id: devices.id,
      name: devices.name,
      lastSeenAt: devices.lastSeenAt,
      ownerName: users.displayName,
      timezone: users.timezone,
    })
    .from(devices)
    .innerJoin(users, eq(users.id, devices.userId))
    .where(
      and(
        eq(devices.alertsEnabled, true),
        isNotNull(devices.lastSeenAt),
        lt(devices.lastSeenAt, cutoff),
        isNull(devices.staleAlertedAt),
      ),
    );

  let sent = 0;
  for (const device of silent) {
    if (device.lastSeenAt === null) continue;
    try {
      await input.alerts(
        silentDeviceAlert({ ...device, lastSeenAt: device.lastSeenAt }, input.staleAfterHours),
      );
      await input.db
        .update(devices)
        .set({ staleAlertedAt: now })
        .where(and(eq(devices.id, device.id), isNull(devices.staleAlertedAt)));
      sent += 1;
    } catch (error) {
      input.logger.error({ err: error, deviceId: device.id }, "silent-device alert failed");
    }
  }
  return sent;
}
