import type { Database } from "../db/database";
import { isUniqueViolation } from "../db/isUniqueViolation";
import { devices } from "../db/schema/devices";
import { HttpError } from "../http/httpError";
import { defaultDeviceKey } from "./defaultDeviceKey";
import { generateDeviceToken } from "./generateDeviceToken";

const deviceKeyConstraint = "devices_user_id_device_key_key";

/**
 * Registers a device. A chosen Device ID must be free among the user's devices
 * (409 otherwise); a generated one is retried on the rare collision.
 */
export async function createDevice(
  db: Database,
  input: { userId: string; name: string; deviceKey?: string | undefined },
): Promise<{ id: string; deviceKey: string; token: string }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const deviceKey = input.deviceKey ?? defaultDeviceKey(input.name);
    const token = generateDeviceToken();
    try {
      const [row] = await db
        .insert(devices)
        .values({
          userId: input.userId,
          name: input.name,
          deviceKey,
          tokenHash: token.hash,
          tokenHint: token.hint,
        })
        .returning({ id: devices.id });
      if (row === undefined) throw new Error("Storing the device returned no row");
      return { id: row.id, deviceKey, token: token.token };
    } catch (error) {
      if (!isUniqueViolation(error, deviceKeyConstraint)) throw error;
      if (input.deviceKey !== undefined) {
        throw new HttpError(409, "conflict", "You already have a device with this Device ID.", {
          deviceKey: ["Already used by another of your devices"],
        });
      }
    }
  }
  throw new Error("Could not generate a unique device key");
}
